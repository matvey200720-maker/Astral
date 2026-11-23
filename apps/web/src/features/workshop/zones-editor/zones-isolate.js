/*
 * Запретная зона на чёрном: только её здание (задача 40 ТЗ 19.10.2026, второй заход).
 *
 * Кусок местности вокруг зоны — земля, дороги и дома из файлов игры, ужатые до 1–1,5 МБ: у запретных зон рядом стоят
 * чужие дома, и они в кадре рваные (ужатая сетка здания рассыпается на осколки, часть текстур не приезжает вовсе). Кадр
 * запретной зоны оставляет в сцене только своё:
 *
 *   • здания зоны — сетки, у которых хоть одна вершина лежит в подножии зоны (с запасом `OWN_PAD`), и те, чей центр в плане лежит
 *     внутри уже взятого здания (остов и фасад одного дома — разные сетки): целиком, на всю высоту и со всеми текстурами, а не
 *     обрезанные рамкой зоны;
 *     Сетка шире `SPAN_SCALE` размеров подножия (задник, стена соседнего дома, склон) зданием не считается и убирается;
 *   • сама зона (её лента или оболочка) — только выбранная, ленты соседних зон в сцене не остаются;
 *   • земля и дороги (сетки земли и ровные сетки: площадки, тротуары, мосты) — треугольники, чей центр лежит в подножии
 *     зоны с запасом `ISOLATE_MARGIN`;
 *   • всё остальное — чужие дома, мелочь, далёкая земля — из сцены убрано, а не спрятано: кадр собирается быстрее и текстур
 *     чужих материалов не просит. Край того, что осталось, гаснет к чёрному по контуру (`edge-fade.js`, форма «контур»).
 *
 * Чистые функции: сцена кадра (`asset`) и id зоны на входе, сцена из оставшегося на выходе.
 */

/** Запас земли и дороги вокруг подножия зоны, м. */
export const ISOLATE_MARGIN = 16;
/** Полоса затухания к чёрному у контура, м. */
export const ISOLATE_FADE = 12;
/** Здание — зонное, если вершина его сетки лежит не дальше этого от подножия зоны, м. */
export const OWN_PAD = 3;
/** Запас вокруг зданий зоны для рамки камеры, м. */
export const FOCUS_PAD = 12;
/**
 * Здание не шире `SPAN_SCALE` размеров подножия зоны (но в пределах `SPAN_MIN`…`SPAN_MAX`, м): сетка шире — не здание зоны, а
 * задник («зелёный экран» студии), стена соседнего дома или склон, что цепляют подножие краем; она убирается.
 */
export const SPAN_SCALE = 3.5;
export const SPAN_MIN = 40;
export const SPAN_MAX = 100;
/** Задники и декорации съёмочной площадки в сцене местности: зданием зоны не бывают, как бы ни цеплялись за подножие. */
export const BACKDROP = /green_?screen|backdrop|skydome/i;

/* Ровная сетка (как `isFlat` в `scripts/prepare-zones-territory.mjs`): у большей части площади грань смотрит вверх, высота невелика. */
function isFlat(mesh) {
  const { positions, indices } = mesh;
  let low = Infinity;
  let high = -Infinity;
  for (let at = 2; at < positions.length; at += 3) {
    if (positions[at] < low) low = positions[at];
    if (positions[at] > high) high = positions[at];
  }
  if (high - low > 14) return false;
  let up = 0;
  let all = 0;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = indices[at] * 3;
    const b = indices[at + 1] * 3;
    const c = indices[at + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    all += length;
    if (Math.abs(nz) > 0.8 * length) up += length;
  }
  return all > 0 && up / all >= 0.6;
}

/* Поля вершин сетки сцены и сколько чисел на вершину. */
const ATTRIBUTES = Object.freeze([
  ["positions", 3],
  ["normals", 3],
  ["uvs", 2],
  ["colours", 4],
  ["uvs1", 2],
]);

/* Сетка из треугольников, чей центр в плане проходит `inside(x, y)`; `null` — таких нет. Вершины перенумерованы. */
function clipMesh(mesh, inside) {
  const p = mesh.positions;
  const index = mesh.indices;
  const keep = [];
  for (let at = 0; at + 2 < index.length; at += 3) {
    const a = index[at] * 3;
    const b = index[at + 1] * 3;
    const c = index[at + 2] * 3;
    if (inside((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3)) keep.push(index[at], index[at + 1], index[at + 2]);
  }
  if (!keep.length) return null;
  if (keep.length === index.length) return mesh;
  const count = p.length / 3;
  const remap = new Int32Array(count).fill(-1);
  let next = 0;
  for (const vertex of keep) if (remap[vertex] < 0) remap[vertex] = next++;
  const out = { ...mesh, indices: Uint32Array.from(keep, (vertex) => remap[vertex]) };
  for (const [name, size] of ATTRIBUTES) {
    const source = mesh[name];
    if (!source || source.length !== count * size) continue;
    const target = new source.constructor(next * size);
    for (let vertex = 0; vertex < count; vertex += 1) {
      const to = remap[vertex];
      if (to < 0) continue;
      for (let k = 0; k < size; k += 1) target[to * size + k] = source[vertex * size + k];
    }
    out[name] = target;
  }
  return out;
}

const spanOf = (positions) => {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let at = 0; at + 2 < positions.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[at + axis];
      if (value < box[axis]) box[axis] = value;
      if (value > box[axis + 3]) box[axis + 3] = value;
    }
  return box;
};

const growBox = (into, box) => {
  if (!into) return [...box];
  for (let axis = 0; axis < 3; axis += 1) {
    into[axis] = Math.min(into[axis], box[axis]);
    into[axis + 3] = Math.max(into[axis + 3], box[axis + 3]);
  }
  return into;
};

/**
 * Сцена запретной зоны только из того, что ей принадлежит.
 *
 * @param {{ meshes?: object[], materials?: object[], bounds?: object }|null|undefined} asset — сцена места (`scene-asset.js`)
 * @param {string} zoneId
 * @param {(info: object) => ({ id: string }|null)} zoneOf — зона по описанию материала (`zoneOfMaterial`)
 * @returns {object|null} сцена из оставшегося: те же материалы и части, `bounds` — по оставшемуся, `focus` — рамка зданий зоны
 *   для камеры (`{ min, max }`), `isolation` — `{ box, needed }`: подножие зоны с запасом `[x0, y0, x1, y1]` и номера материалов
 *   оставшихся сеток; `null`, если у зоны в сцене нет сеток (кадр остаётся как был)
 */
export function isolateZone(asset, zoneId, zoneOf, { margin = ISOLATE_MARGIN, pad = OWN_PAD } = {}) {
  if (!asset?.meshes?.length || !asset.materials?.length) return null;
  let foot = null;
  for (const mesh of asset.meshes) {
    if (!mesh?.positions?.length) continue;
    if (zoneOf(asset.materials[mesh.material])?.id === zoneId) foot = growBox(foot, spanOf(mesh.positions));
  }
  if (!foot) return null;
  const near = [foot[0] - pad, foot[1] - pad, foot[3] + pad, foot[4] + pad];
  const buildingSpan = Math.min(SPAN_MAX, Math.max(SPAN_MIN, SPAN_SCALE * Math.max(foot[3] - foot[0], foot[4] - foot[1])));
  const around = [foot[0] - margin, foot[1] - margin, foot[3] + margin, foot[4] + margin];
  const inAround = (x, y) => x >= around[0] && x <= around[2] && y >= around[1] && y <= around[3];
  const kept = [];
  const owned = [];
  const candidates = [];
  let focus = null;
  for (const mesh of asset.meshes) {
    if (!mesh?.positions?.length) continue;
    const info = asset.materials[mesh.material] || {};
    const owner = zoneOf(info);
    if (owner) {
      if (owner.id !== zoneId) continue;
      kept.push(mesh);
      focus = growBox(focus, spanOf(mesh.positions));
      continue;
    }
    if (info.group === "terrain" || isFlat(mesh)) {
      const clipped = clipMesh(mesh, inAround);
      if (clipped) kept.push(clipped);
      continue;
    }
    if (BACKDROP.test(String(info.name || info.id || ""))) continue;
    const span = spanOf(mesh.positions);
    if (Math.max(span[3] - span[0], span[4] - span[1]) > buildingSpan) continue;
    /* Здание: хоть одна вершина в подножии зоны — целиком. */
    const p = mesh.positions;
    let own = false;
    for (let at = 0; at + 1 < p.length; at += 3)
      if (p[at] >= near[0] && p[at] <= near[2] && p[at + 1] >= near[1] && p[at + 1] <= near[3]) {
        own = true;
        break;
      }
    if (!own) {
      candidates.push(mesh);
      continue;
    }
    kept.push(mesh);
    owned.push(span);
    focus = growBox(focus, span);
  }
  /* Остов и фасад одного здания — разные сетки: вершины фасада могут не лежать в подножии (зона — нижний ярус). Сетка, чей центр
     в плане лежит внутри уже взятого здания, — часть его же; берётся целиком, и так, пока что-то добавляется. */
  for (let round = 0; round < 3 && candidates.length; round += 1) {
    let added = false;
    for (let at = candidates.length - 1; at >= 0; at -= 1) {
      const box = spanOf(candidates[at].positions);
      if (Math.max(box[3] - box[0], box[4] - box[1]) > buildingSpan) continue;
      const cx = (box[0] + box[3]) / 2;
      const cy = (box[1] + box[4]) / 2;
      if (!owned.some((b) => cx >= b[0] - 1 && cx <= b[3] + 1 && cy >= b[1] - 1 && cy <= b[4] + 1)) continue;
      kept.push(candidates[at]);
      owned.push(box);
      focus = growBox(focus, box);
      candidates.splice(at, 1);
      added = true;
    }
    if (!added) break;
  }
  if (!kept.length) return null;
  let all = null;
  for (const mesh of kept) all = growBox(all, spanOf(mesh.positions));
  const needed = new Set(kept.map((mesh) => mesh.material));
  return {
    ...asset,
    meshes: kept,
    bounds: { min: [all[0], all[1], all[2]], max: [all[3], all[4], all[5]] },
    focus: { min: [focus[0] - FOCUS_PAD, focus[1] - FOCUS_PAD, focus[2]], max: [focus[3] + FOCUS_PAD, focus[4] + FOCUS_PAD, focus[5]] },
    isolation: { box: around, needed },
  };
}
