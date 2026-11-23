/*
 * Перелёт камеры к вещи изнутри помещения (арены, интерьеры Majestic): глаз ищется вокруг вещи на расстоянии, с которого она целиком в
 * кадре, и там, откуда линию взгляда не закрывает стена. Чистые функции без React и three; арена берёт их через `arena-items.js`.
 *
 * Лучи идут по дереву коробок сетки (`mesh.rayTree`, его считает поток кадра, `ray-accel.js`); пока дерева нет — перебором треугольников, ответ тот же.
 */

import { walkTriangleBvh } from "../model-stage/triangle-bvh.js";
import { itemElementPlane } from "@modovik/climb-contract/recolor/item-elements";

/*
 * Лицо плоской вещи (монитор, экран, плакат, табличка) в сцене: `{ normal, sided }` — нормаль плоскости (сторона, с которой своя картинка читается,
 * как у проекции `itemElementPlane`), `sided` — лицо решено перевесом граней (у двусторонней вещи — нет); `null` — вещь объёмная. Камера подлетает
 * с лица: свободная линия до монитора есть и сзади, и 01.11.2026 камера встала за изогнутым монитором фестиваля, в соседней комнате.
 */
const fronts = new WeakMap();
export function itemFront(asset, key) {
  if (!asset?.meshes || !Number.isInteger(key)) return null;
  let byKey = fronts.get(asset);
  if (!byKey) fronts.set(asset, (byKey = new Map()));
  if (!byKey.has(key)) {
    const plane = itemElementPlane(asset.meshes.filter((mesh) => mesh.entity === key));
    byKey.set(key, plane && plane.facing >= 0.8 ? { normal: plane.normal, sided: plane.sided } : null);
  }
  return byKey.get(key);
}

/*
 * Середины самых больших треугольников вещи (до `SURFACE_POINTS`): точки, что точно лежат на ней. Ими «видно ли» (`scene-parts.js: itemSeen`) и
 * перелёт (`itemFocus`) проверяют вещь, а не середину рамки: у дуги она висит в воздухе, у ящика в нише — за плоскостью стены. Раз на сцену и вещь.
 */
const SURFACE_POINTS = 4;
const surfaces = new WeakMap();
export function itemSurfacePoints(asset, key) {
  if (!asset?.meshes || !Number.isInteger(key)) return [];
  let byKey = surfaces.get(asset);
  if (!byKey) surfaces.set(asset, (byKey = new Map()));
  if (byKey.has(key)) return byKey.get(key);
  const best = [];
  for (const mesh of asset.meshes) {
    if (mesh.entity !== key) continue;
    const { positions, indices } = mesh;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const [a, b, c] = [indices[at] * 3, indices[at + 1] * 3, indices[at + 2] * 3];
      const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
      const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
      const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
      if (best.length === SURFACE_POINTS && area <= best[best.length - 1].area) continue;
      best.push({ area, point: [0, 1, 2].map((axis) => (positions[a + axis] + positions[b + axis] + positions[c + axis]) / 3) });
      best.sort((left, right) => right.area - left.area);
      if (best.length > SURFACE_POINTS) best.pop();
    }
  }
  const points = best.map((item) => item.point);
  byKey.set(key, points);
  return points;
}

const meshBox = new WeakMap();
function boxOf(mesh) {
  let box = meshBox.get(mesh);
  if (!box) {
    box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const at = mesh.positions;
    for (let index = 0; index < at.length; index += 3)
      for (let axis = 0; axis < 3; axis += 1) {
        box.min[axis] = Math.min(box.min[axis], at[index + axis]);
        box.max[axis] = Math.max(box.max[axis], at[index + axis]);
      }
    meshBox.set(mesh, box);
  }
  return box;
}

/* Определитель последнего попадания: положителен, когда луч идёт против нормали грани (видит её лицо). */
let lastDet = 0;

/* Луч `o + d·t` и треугольник сетки (Мёллер — Трумбор, без учёта стороны): `t` или `-1`. Без массивов на треугольник: у зала их сотни тысяч. */
function rayTriangle(positions, indices, triangle, ox, oy, oz, dx, dy, dz) {
  const i = indices[triangle * 3] * 3;
  const j = indices[triangle * 3 + 1] * 3;
  const k = indices[triangle * 3 + 2] * 3;
  const ax = positions[i];
  const ay = positions[i + 1];
  const az = positions[i + 2];
  const e1x = positions[j] - ax;
  const e1y = positions[j + 1] - ay;
  const e1z = positions[j + 2] - az;
  const e2x = positions[k] - ax;
  const e2y = positions[k + 1] - ay;
  const e2z = positions[k + 2] - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-9 && det < 1e-9) return -1;
  const tx = ox - ax;
  const ty = oy - ay;
  const tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) / det;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) / det;
  if (v < 0 || u + v > 1) return -1;
  lastDet = det;
  return (e2x * qx + e2y * qy + e2z * qz) / det;
}

/* Треугольники сетки на луче: `visit(triangle)` — по дереву, если оно есть, иначе все. */
function eachTriangle(mesh, ox, oy, oz, dx, dy, dz, reach, visit) {
  if (mesh.rayTree) {
    walkTriangleBvh(mesh.rayTree, ox, oy, oz, dx, dy, dz, reach, visit);
    return;
  }
  const count = Math.floor(mesh.indices.length / 3);
  for (let triangle = 0; triangle < count; triangle += 1) visit(triangle);
}

/* Лежит ли коробка сетки в стороне от отрезка. */
const offSegment = (mesh, lo, hi) => {
  const box = boxOf(mesh);
  return box.max[0] < lo[0] || box.min[0] > hi[0] || box.max[1] < lo[1] || box.min[1] > hi[1] || box.max[2] < lo[2] || box.min[2] > hi[2];
};
const segmentBox = (from, to) => [[0, 1, 2].map((axis) => Math.min(from[axis], to[axis]) - 0.01), [0, 1, 2].map((axis) => Math.max(from[axis], to[axis]) + 0.01)];

/** Свободна ли линия глаза от стен: отрезок не пересекает ни одной сетки, кроме сеток самой вещи `skip`. */
export function lineIsClear(asset, from, to, skip) {
  const [lo, hi] = segmentBox(from, to);
  const [ox, oy, oz] = from;
  const dx = to[0] - ox;
  const dy = to[1] - oy;
  const dz = to[2] - oz;
  for (const mesh of asset.meshes || []) {
    if (mesh.entity === skip || offSegment(mesh, lo, hi)) continue;
    let blocked = false;
    eachTriangle(mesh, ox, oy, oz, dx, dy, dz, 1, (triangle) => {
      if (blocked) return;
      const along = rayTriangle(mesh.positions, mesh.indices, triangle, ox, oy, oz, dx, dy, dz);
      if (along > 0.02 && along < 0.98) blocked = true;
    });
    if (blocked) return false;
  }
  return true;
}

/* Ближайший треугольник под лучом `from + dir·t`, 0 < t ≤ reach: `{ distance, front }` (`front` — смотрит ли лицом к лучу; двусторонний материал — всегда лицом) или `null`. */
function firstHit(asset, from, dir, reach) {
  const [lo, hi] = segmentBox(
    from,
    from.map((value, axis) => value + dir[axis] * reach),
  );
  const [ox, oy, oz] = from;
  const [dx, dy, dz] = dir;
  let best = null;
  for (const mesh of asset.meshes || []) {
    if (offSegment(mesh, lo, hi)) continue;
    const both = Boolean(asset.materials?.[mesh.material]?.doubleSided);
    eachTriangle(mesh, ox, oy, oz, dx, dy, dz, reach, (triangle) => {
      const distance = rayTriangle(mesh.positions, mesh.indices, triangle, ox, oy, oz, dx, dy, dz);
      if (distance <= 1e-4 || distance > reach || (best && distance >= best.distance)) return;
      best = { distance, front: both || lastDet > 0 };
    });
  }
  return best;
}

/* Сколько до стен проверять и как близко к ним глазу нельзя: ближняя плоскость кадра иначе режет стену. */
const ROOM_REACH = 160;
const ROOM_MARGIN = 0.25;
const ROOM_SIDES = Object.freeze([
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
]);

/**
 * Стоит ли глаз внутри помещения сцены: внутри её рамки, под ногами лицо пола, над головой лицо потолка, стены вокруг (одна сторона может быть открыта: дверь, проём)
 * и ни к чему не прижат. Над подвесным потолком и в толще вещи луч видит изнанку — там глаз не стоит. Сцена без сеток — нечего сказать: `true`.
 */
export function eyeInRoom(asset, eye) {
  if (!asset?.meshes?.length) return true;
  const bounds = asset.bounds;
  if (bounds && eye.some((value, axis) => value < bounds.min[axis] + ROOM_MARGIN || value > bounds.max[axis] - ROOM_MARGIN)) return false;
  for (const dir of [[0, 0, -1], [0, 0, 1]]) {
    const hit = firstHit(asset, eye, dir, ROOM_REACH);
    if (!hit || !hit.front || hit.distance < ROOM_MARGIN) return false;
  }
  let open = 0;
  for (const dir of ROOM_SIDES) {
    const hit = firstHit(asset, eye, dir, ROOM_REACH);
    if (!hit) open += 1;
    else if (hit.distance < ROOM_MARGIN) return false;
  }
  return open <= 1;
}

const poseOf = (eye, target, fov) => {
  const look = target.map((value, axis) => value - eye[axis]);
  const span = Math.hypot(...look) || 1;
  return { eye, yaw: Math.atan2(look[0], look[1]), pitch: Math.asin(Math.max(-1, Math.min(1, look[2] / span))), fov };
};

/* Поиск места не дольше этого (мс): выбор из списка не должен подвешивать окно; не успели — лучшее из найденного. */
const SEARCH_MS = 160;
const now = () => (typeof performance === "object" ? performance.now() : Date.now());

/* Глаз — в рамке сцены (сцена без помещения: площадь, открытое место). */
const withinBounds = (asset, eye) => !asset?.bounds || eye.every((value, axis) => value >= asset.bounds.min[axis] && value <= asset.bounds.max[axis]);
const clampToBounds = (asset, eye) => (asset?.bounds ? eye.map((value, axis) => Math.min(asset.bounds.max[axis], Math.max(asset.bounds.min[axis], value))) : eye);

/* Стороны по близости к «со стороны зала»: 0, ±22°, ±45°… до противоположной. */
const TURNS = Object.freeze([0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8].map((step) => step * (Math.PI / 8)));
/*
 * Как близко к точке на вещи линии глаза можно не проверять (метры): наклейка или рамка вровень с её лицом не заслоняет. Раньше вещь с номером
 * проверялась до середины рамки без последних `min(3, размер/2)` метров — и 01.11.2026 «Показать» у дивана Majestic поставил камеру за стеной
 * с табло: стена стоит в 1,4 м от середины дивана, а не проверялись 1,8 м.
 */
const SEE_SLACK = 0.15;
/* Вещь больше этого (метры по диагонали) из помещения целиком не увидеть: смотрим на её часть. */
const WHOLE_SIZE = 7;
const distanceFor = (size) => Math.max(2.2, Math.min(40, size * 1.35 + 1.2));

/**
 * Перелёт камеры к предмету: `{ eye, yaw, pitch, fov }` для `insideFocus`. Глаз ищется вокруг предмета на расстоянии, с которого он целиком в кадре: сначала со стороны глаза
 * зала по умолчанию (`home`), затем с других сторон и ближе — первое место внутри помещения (`eyeInRoom`, владелец 31.10.2026: «камера улетает за пределы карты»), откуда линия
 * глаза к предмету свободна от стен (`asset` и `key`: сетки самой вещи не в счёт). Вещь под крышей смотрят снизу: на её же высоте глаз вышел бы над потолком. Взгляд — в точку на
 * самой вещи у середины её рамки; у вещи без размера (одна точка) расстояние наименьшее.
 *
 * Вещь на несколько комнат (свет, оболочка) целиком не показать: не нашлось места для всей — глаз подходит к её точке у середины. Свободной линии нет ни откуда (вещь в подвале, которого в
 * кадре нет): мелкая — глаз в помещении ближе всего к ней, большая — глаз зала. Глаз зала сам стоит не в помещении (открытая сцена) — помещение не проверяется, только рамка сцены.
 */
export function itemFocus(home, box, { fov = 62, asset = null, key = null } = {}) {
  if (!box) return null;
  /* Предмет целиком: большая оболочка (стена, зал) — от середины рамки, а не от точки у потолка; отступ — от её размера. */
  const diagonal = Math.hypot(...[0, 1, 2].map((axis) => box.max[axis] - box.min[axis]));
  if (!Number.isFinite(diagonal)) return null;
  const middle = [0, 1, 2].map((axis) => (box.min[axis] + box.max[axis]) / 2);
  const centre = box.anchor && diagonal <= WHOLE_SIZE ? box.anchor : middle;
  const from = home || [0, 0, 1.7];
  const room = Boolean(asset && eyeInRoom(asset, from));
  const started = now();
  /* Места, откуда вещь не видна, по порядку обхода: запасной глаз — последнее из них в помещении (ближе всех), считается, только если понадобился. */
  const missed = [];
  /* Плоская вещь — с лица: стороны ищутся от её нормали, места за её плоскостью не годятся; у двусторонней — потом и с изнанки. */
  const face = itemFront(asset, key);
  const sides = face ? (face.sided ? [face.normal] : [face.normal, face.normal.map((value) => -value)]) : [null];
  let front = sides[0];
  const facesFront = (candidate, point) => !front || (candidate[0] - point[0]) * front[0] + (candidate[1] - point[1]) * front[1] + (candidate[2] - point[2]) * front[2] > 0.1;

  /* Сторона, с которой смотрит зал (у плоской вещи — её лицо); глаз зала прямо над вещью — с юга. */
  const sideOf = (point) => {
    if (front && Math.hypot(front[0], front[1]) > 0.3) return Math.atan2(front[1], front[0]);
    const flat = [from[0] - point[0], from[1] - point[1]];
    return Math.hypot(flat[0], flat[1]) < 0.2 ? Math.atan2(-1, 0) : Math.atan2(flat[1], flat[0]);
  };

  /* Помещение у места глаза — раз на место: второй проход (`loose`) идёт по тем же местам. */
  const inRoom = new Map();
  const roomAt = (candidate) => {
    const id = candidate.join(",");
    if (!inRoom.has(id)) inRoom.set(id, eyeInRoom(asset, candidate));
    return inRoom.get(id);
  };

  /* Первое годное место вокруг `point` для вещи размером `size`: поза или `null`. `loose` — годится и место, откуда видна лишь точка на поверхности вещи. */
  const around = (point, size, until, loose = false) => {
    const base = sideOf(point);
    const distance = distanceFor(size);
    const height = point[2] + Math.min(0.7, size * 0.2);
    /*
     * Вещь с номером (`key`, её сетки линию не заслоняют) видна, если свободна линия к точке взгляда — до `SEE_SLACK`; во втором проходе (`loose`) —
     * и к одной из точек на её поверхности: ящик в нише стены виден по лицу, хотя середина его рамки — за плоскостью стены. Сначала — место, откуда
     * видна середина: иначе у длинных перил годился первый же глаз, что видит один их конец. Без номера линия упирается в саму цель: ей хватает
     * дойти до вещи, последние `min(3, размер/2)` метров не проверяются.
     */
    const slack = Number.isInteger(key) ? SEE_SLACK : Math.min(3, size / 2);
    const targets = loose ? [point, ...itemSurfacePoints(asset, key)] : [point];
    const clearTo = (candidate, target) => {
      const gap = Math.hypot(...target.map((value, axis) => value - candidate[axis])) || 1;
      const share = Math.max(0, gap - slack) / gap;
      return lineIsClear(asset, candidate, target.map((value, axis) => candidate[axis] + (value - candidate[axis]) * share), key);
    };
    const sees = (candidate) => targets.some((target) => clearTo(candidate, target));
    for (const scale of [1, 0.7, 0.5, 0.3]) {
      const away = distance * scale;
      /* Высоты: чуть выше вещи; снизу — вещи под потолком (вровень с плоским плафоном его видно ребром); на её уровне. */
      for (const level of [height, point[2] - away * 0.5, point[2]]) {
        /* Со стороны зала — все стороны, дальше — через одну: вещь, что не видна ниоткуда, не держит окно. */
        for (const [index, turn] of TURNS.entries()) {
          if ((scale < 1 || level !== height) && index % 2 && index < TURNS.length - 1) continue;
          if (now() - started > until) return null;
          const candidate = [point[0] + Math.cos(base + turn) * away, point[1] + Math.sin(base + turn) * away, level];
          if ((!room && !withinBounds(asset, candidate)) || !facesFront(candidate, point)) continue;
          /*
           * Сначала линия до вещи (проход по сцене на точку), помещение — только у места, откуда вещь видно (шесть лучей до 160 м): первое годное место то же, а
           * поиск в зале с тысячами сеток не упирается в предел времени (01.11.2026: у 70 из 604 вещей Majestic «Показать» брал запасной глаз — и за стеной).
           */
          if (sees(candidate) && (!room || roomAt(candidate))) return poseOf(candidate, point, fov);
          missed.push(candidate);
        }
      }
    }
    return null;
  };

  /* Без сцены проверять нечего: глаз — со стороны зала. */
  if (!asset) {
    const distance = distanceFor(diagonal);
    const base = sideOf(centre);
    return poseOf([centre[0] + Math.cos(base) * distance, centre[1] + Math.sin(base) * distance, centre[2] + Math.min(0.7, diagonal * 0.2)], centre, fov);
  }
  const part = box.anchor && diagonal > WHOLE_SIZE ? box.anchor : null;
  let found = null;
  for (const side of sides) {
    front = side;
    const whole = part ? SEARCH_MS * 0.6 : SEARCH_MS;
    found =
      (Number.isInteger(key) ? around(centre, diagonal, whole * 0.6) || around(centre, diagonal, whole, true) : around(centre, diagonal, whole)) ||
      (part ? around(part, WHOLE_SIZE * 0.8, SEARCH_MS) : null);
    if (found) break;
  }
  if (found) return found;
  /* Ближе — лучше: последнее место в помещении стоит ближе всех. */
  const closest = () => {
    for (let at = missed.length - 1; at >= 0; at -= 1) if (!room || roomAt(missed[at])) return missed[at];
    return null;
  };
  if (room) return poseOf((diagonal <= WHOLE_SIZE && closest()) || from, centre, fov);
  const base = sideOf(centre);
  const distance = distanceFor(diagonal);
  return poseOf(clampToBounds(asset, closest() || [centre[0] + Math.cos(base) * distance, centre[1] + Math.sin(base) * distance, centre[2] + Math.min(0.7, diagonal * 0.2)]), centre, fov);
}
