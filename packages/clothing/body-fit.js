/*
 * Вещь садится на тело персонажа (01.11.2026, владелец: «выбрал скелетные перчатки — появились дополнительные руки»; 02.11.2026: «от одних перчаток пропадает кисть, от других плечи … чтобы ни хрена не пропадало, текстурки не вылазили, всё как на человеке»).
 *
 * Персонаж мастерской собирает тело отдельно от вещей: кожа лежит под тканью и там, где ткань тесна, пробивает её пятнами. Игра этого не знает: у неё к каждому верху и перчаткам своя пара `uppr`.
 *
 * Снимать кожу по костям, которые есть у вещи, нельзя: у разных перчаток в весах оказываются то предплечье, то плечо, и пропадало то, что перчатка не закрывает. Поэтому `withoutCoveredSkin` смотрит на сами сетки:
 * из каждой вершины кожи идёт луч по нормали, и вершина закрыта, когда ткань лежит рядом снаружи или кожа её уже пробила. Треугольник уходит, только если закрыты все три вершины. Всё, что видно из-под вещи, — вырез, запястье, плечо без рукава — остаётся.
 *
 * Отдельная беда — моды без весов («Скелеты на руки»: авторы экспортируют сетку без привязки). У живого персонажа такая вещь стоит в позе привязки, пока тело покачивается
 * рядом, — это и были «лишние руки». `withBodySkin` выдаёт ей веса ближайших вершин тела, которое лежит в той же позе привязки.
 */

/* Ткань дальше — кожа её не пробивает, а прятать кожу незачем: снизу и в вырез она видна. */
const CLOTH_OUTSIDE = 0.025;
/* Насколько кожа может торчать сквозь ткань. Не больше доли толщины самой части тела: у пальца луч назад иначе попал бы в ладонь перчатки. */
const CLOTH_INSIDE = 0.05;
const THICKNESS_SHARE = 0.6;
const SELF_SKIP = 0.004;
const RAY_CELL = 0.05;

/* Ключ клетки числом: строка на каждую клетку заметна уже на одном моде. */
const numericKey = (x, y, z) => (x + 2048) * 16777216 + (y + 2048) * 4096 + (z + 2048);

/** Треугольники сетки в клетках: `{ cells, points, box }`, в `points` по девять чисел на треугольник. */
function triangleGrid(meshes) {
  let total = 0;
  for (const mesh of meshes) if (mesh.positions && mesh.indices) total += mesh.indices.length - mesh.indices.length % 3;
  const points = new Float32Array(total * 3);
  const cells = new Map();
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let id = 0;
  for (const mesh of meshes) {
    if (!mesh.positions || !mesh.indices) continue;
    const { positions, indices } = mesh;
    for (let at = 0; at + 2 < indices.length; at += 3, id += 1) {
      const from = id * 9;
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = indices[at + corner] * 3;
        points[from + corner * 3] = positions[vertex];
        points[from + corner * 3 + 1] = positions[vertex + 1];
        points[from + corner * 3 + 2] = positions[vertex + 2];
      }
      const lowX = Math.min(points[from], points[from + 3], points[from + 6]);
      const lowY = Math.min(points[from + 1], points[from + 4], points[from + 7]);
      const lowZ = Math.min(points[from + 2], points[from + 5], points[from + 8]);
      const highX = Math.max(points[from], points[from + 3], points[from + 6]);
      const highY = Math.max(points[from + 1], points[from + 4], points[from + 7]);
      const highZ = Math.max(points[from + 2], points[from + 5], points[from + 8]);
      if (lowX < box[0]) box[0] = lowX;
      if (lowY < box[1]) box[1] = lowY;
      if (lowZ < box[2]) box[2] = lowZ;
      if (highX > box[3]) box[3] = highX;
      if (highY > box[4]) box[4] = highY;
      if (highZ > box[5]) box[5] = highZ;
      const endX = Math.floor(highX / RAY_CELL);
      const endY = Math.floor(highY / RAY_CELL);
      const endZ = Math.floor(highZ / RAY_CELL);
      for (let x = Math.floor(lowX / RAY_CELL); x <= endX; x += 1)
        for (let y = Math.floor(lowY / RAY_CELL); y <= endY; y += 1)
          for (let z = Math.floor(lowZ / RAY_CELL); z <= endZ; z += 1) {
            const key = numericKey(x, y, z);
            const cell = cells.get(key);
            if (cell) cell.push(id);
            else cells.set(key, [id]);
          }
    }
  }
  return { cells, points, box };
}

/**
 * Расстояние по лучу до первого треугольника дальше `skip` и не дальше `length`; `-1` — нет такого. `any` — хватит любого попадания, ближайшее не нужно.
 */
function rayHit(grid, ox, oy, oz, dx, dy, dz, length, skip, any) {
  const { cells, points } = grid;
  let best = -1;
  let last = NaN;
  const steps = Math.ceil(length / (RAY_CELL / 2));
  for (let step = 0; step <= steps; step += 1) {
    const along = (length * step) / steps;
    const key = numericKey(Math.floor((ox + dx * along) / RAY_CELL), Math.floor((oy + dy * along) / RAY_CELL), Math.floor((oz + dz * along) / RAY_CELL));
    if (key === last) continue;
    last = key;
    const cell = cells.get(key);
    if (!cell) continue;
    for (let index = 0; index < cell.length; index += 1) {
      const at = cell[index] * 9;
      const ax = points[at];
      const ay = points[at + 1];
      const az = points[at + 2];
      const ex = points[at + 3] - ax;
      const ey = points[at + 4] - ay;
      const ez = points[at + 5] - az;
      const fx = points[at + 6] - ax;
      const fy = points[at + 7] - ay;
      const fz = points[at + 8] - az;
      const px = dy * fz - dz * fy;
      const py = dz * fx - dx * fz;
      const pz = dx * fy - dy * fx;
      const det = ex * px + ey * py + ez * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const sx = ox - ax;
      const sy = oy - ay;
      const sz = oz - az;
      const u = (sx * px + sy * py + sz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy * ez - sz * ey;
      const qy = sz * ex - sx * ez;
      const qz = sx * ey - sy * ex;
      const v = (dx * qx + dy * qy + dz * qz) / det;
      if (v < 0 || u + v > 1) continue;
      const t = (fx * qx + fy * qy + fz * qz) / det;
      if (t < skip || t > length) continue;
      if (any) return t;
      if (best < 0 || t < best) best = t;
    }
    /* Точка уже дальше найденного: ближе в следующих клетках не будет. */
    if (best >= 0 && best <= along) break;
  }
  return best;
}

/* Нормали сетки: своя или по граням, единичной длины. Вершина без граней — нулевая, такая закрытой не считается. */
function normalsOf(mesh) {
  const { positions, indices } = mesh;
  const out = new Float32Array(positions.length);
  if (mesh.normals?.length === positions.length) out.set(mesh.normals);
  else
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = indices[at] * 3;
      const b = indices[at + 1] * 3;
      const c = indices[at + 2] * 3;
      const ex = positions[b] - positions[a];
      const ey = positions[b + 1] - positions[a + 1];
      const ez = positions[b + 2] - positions[a + 2];
      const fx = positions[c] - positions[a];
      const fy = positions[c + 1] - positions[a + 1];
      const fz = positions[c + 2] - positions[a + 2];
      for (const corner of [a, b, c]) {
        out[corner] += ey * fz - ez * fy;
        out[corner + 1] += ez * fx - ex * fz;
        out[corner + 2] += ex * fy - ey * fx;
      }
    }
  for (let at = 0; at < out.length; at += 3) {
    const size = Math.hypot(out[at], out[at + 1], out[at + 2]);
    if (size > 0) {
      out[at] /= size;
      out[at + 1] /= size;
      out[at + 2] /= size;
    }
  }
  return out;
}

/*
 * Результат живёт, пока живы сетки: смена сумки не считает заново кожу под кофтой, смена кофты — под перчатками. Ключ — массив вершин (вещи и части тела в памяти Desktop одни и те же между сборками).
 * Части тела считаются один раз: нормали и насколько можно заглянуть внутрь (`insideOf`), вещь считается один раз на часть тела (`closedBy`).
 */
const skinOf = new WeakMap();
const clothOf = new WeakMap();

function skinData(drawable, mesh) {
  const known = skinOf.get(mesh.positions);
  if (known) return known;
  const self = triangleGrid(drawable.meshes);
  const { positions } = mesh;
  const normals = normalsOf(mesh);
  const inside = new Float32Array(positions.length / 3);
  for (let vertex = 0; vertex < inside.length; vertex += 1) {
    const at = vertex * 3;
    const thick = rayHit(self, positions[at], positions[at + 1], positions[at + 2], -normals[at], -normals[at + 1], -normals[at + 2], CLOTH_INSIDE / THICKNESS_SHARE, SELF_SKIP, false);
    inside[vertex] = thick < 0 ? CLOTH_INSIDE : Math.min(CLOTH_INSIDE, thick * THICKNESS_SHARE);
  }
  const data = { normals, inside };
  skinOf.set(mesh.positions, data);
  return data;
}

function closedBy(cloth, mesh, skin) {
  let byBody = clothOf.get(cloth.positions);
  if (!byBody) clothOf.set(cloth.positions, (byBody = { grid: null, marks: new WeakMap() }));
  const known = byBody.marks.get(mesh.positions);
  if (known) return known;
  byBody.grid ||= triangleGrid([cloth]);
  const { grid } = byBody;
  const { box } = grid;
  const { positions } = mesh;
  const { normals, inside } = skin;
  const marks = new Uint8Array(positions.length / 3);
  const margin = CLOTH_INSIDE + CLOTH_OUTSIDE;
  for (let vertex = 0; vertex < marks.length; vertex += 1) {
    const at = vertex * 3;
    const x = positions[at];
    const y = positions[at + 1];
    const z = positions[at + 2];
    if (x < box[0] - margin || y < box[1] - margin || z < box[2] - margin || x > box[3] + margin || y > box[4] + margin || z > box[5] + margin) continue;
    const nx = normals[at];
    const ny = normals[at + 1];
    const nz = normals[at + 2];
    if (nx === 0 && ny === 0 && nz === 0) continue;
    const back = inside[vertex];
    if (rayHit(grid, x - nx * back, y - ny * back, z - nz * back, nx, ny, nz, back + CLOTH_OUTSIDE, 0, true) >= 0) marks[vertex] = 1;
  }
  byBody.marks.set(mesh.positions, marks);
  return marks;
}

/*
 * Кисть вещи вместо кисти тела (03.11.2026, владелец: «перчатки из игры — кисть и пальцы под ними деформированы, как оторванные»). Перчатки игры и модов — модель `uppr`: у неё своя
 * кисть целиком, вместе с голыми пальцами у перчаток без пальцев (`mplts` №0/№1: 1702 вершины, кончики пальцев там же, где у тела). В игре `uppr` один — кисти тела под перчаткой нет.
 * Луч по нормали (`closedBy`) для пальцев не годится: палец тоньше зазора, луч назад укорочен толщиной (иначе он попал бы в ладонь), и пальцы тела закрывались через один —
 * торчали кусками сквозь пальцы перчатки. Поэтому по весам: вещь, у которой есть своя кисть (вершины на костях пальцев этой руки), снимает с тела треугольники, лежащие целиком на кисти той же руки.
 *
 * Метка ставится до позы (`withHandMarks`): у запечённой в позу сетки весов уже нет (`poseMeshes`), а порядок вершин тот же. `hands` у сетки — по байту на вершину: 1 — левая кисть, 2 — правая.
 */
const LEFT_HAND = 42;
const RIGHT_HAND = 71;
const HAND_BONES = 23;
/* Вершина на кисти: больше половины её веса — на костях кисти и пальцев. */
const HAND_SHARE = 0.5;
/* Своя кисть у вещи — столько вершин на пальцах (кости кисти без самой кости запястья): у рукава с манжетой у запястья их нет. */
const MIN_FINGER_VERTICES = 30;

const handOf = (joint) => (joint >= LEFT_HAND && joint < LEFT_HAND + HAND_BONES ? 1 : joint >= RIGHT_HAND && joint < RIGHT_HAND + HAND_BONES ? 2 : 0);

const handMarks = new WeakMap();
function marksOf(mesh) {
  const skin = mesh?.skin;
  if (!skin?.joints || !skin?.weights || !mesh.positions?.length) return null;
  const known = handMarks.get(skin.joints);
  if (known) return known;
  const count = mesh.positions.length / 3;
  const hands = new Uint8Array(count);
  const fingers = [0, 0, 0];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const share = [0, 0, 0];
    let total = 0;
    let top = -1;
    let topWeight = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = skin.weights[vertex * 4 + slot];
      if (!(weight > 0)) continue;
      const joint = skin.joints[vertex * 4 + slot];
      total += weight;
      share[handOf(joint)] += weight;
      if (weight > topWeight) {
        topWeight = weight;
        top = joint;
      }
    }
    if (!(total > 0)) continue;
    const side = share[1] / total > HAND_SHARE ? 1 : share[2] / total > HAND_SHARE ? 2 : 0;
    hands[vertex] = side;
    if (side && top !== LEFT_HAND && top !== RIGHT_HAND && handOf(top) === side) fingers[side] += 1;
  }
  const marks = { hands, sides: (fingers[1] >= MIN_FINGER_VERTICES ? 1 : 0) | (fingers[2] >= MIN_FINGER_VERTICES ? 2 : 0) };
  handMarks.set(skin.joints, marks);
  return marks;
}

/** Сетки с метками кисти (`hands`, `handSides`) по весам; без весов — как есть. Ставится до позы: после запекания весов нет, а метки едут за вершинами. */
export function withHandMarks(drawable) {
  if (!drawable?.meshes?.some((mesh) => mesh.skin)) return drawable;
  return {
    ...drawable,
    meshes: drawable.meshes.map((mesh) => {
      const marks = marksOf(mesh);
      return marks ? { ...mesh, hands: marks.hands, handSides: marks.sides } : mesh;
    }),
  };
}

/** Какие кисти вещи свои: 1 — левая, 2 — правая (по меткам `withHandMarks`). */
const ownHands = (meshes) => meshes.reduce((sides, mesh) => sides | (mesh.handSides || 0), 0);

/**
 * Часть тела без кожи под вещами `covers` (сетки в той же позе, что и тело). Сетки и веса не правятся: собирается новый список индексов, поэтому общая запись в памяти (`bodyParts`) остаётся целой.
 * Вещь со своей кистью (метки `withHandMarks`) снимает кисть тела той же руки целиком.
 */
export function withoutCoveredSkin(drawable, covers) {
  if (!drawable?.meshes?.length || !covers?.length) return drawable;
  const cloths = covers.flatMap((cover) => cover?.meshes || []).filter((mesh) => mesh.positions?.length && mesh.indices?.length);
  if (!cloths.length) return drawable;
  const replacedHands = ownHands(cloths);
  const meshes = [];
  for (const mesh of drawable.meshes) {
    if (!mesh.positions || !mesh.indices) {
      meshes.push(mesh);
      continue;
    }
    const skin = skinData(drawable, mesh);
    const marks = cloths.map((cloth) => closedBy(cloth, mesh, skin));
    const closed = marks.length === 1 ? marks[0] : new Uint8Array(mesh.positions.length / 3);
    if (marks.length > 1)
      for (const mark of marks)
        for (let vertex = 0; vertex < mark.length; vertex += 1) closed[vertex] |= mark[vertex];
    const { indices } = mesh;
    const hands = replacedHands && mesh.hands?.length === mesh.positions.length / 3 ? mesh.hands : null;
    const kept = new indices.constructor(indices.length);
    let length = 0;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = indices[at];
      const b = indices[at + 1];
      const c = indices[at + 2];
      if (closed[a] && closed[b] && closed[c]) continue;
      if (hands && (hands[a] & replacedHands) !== 0 && hands[a] === hands[b] && hands[a] === hands[c]) continue;
      kept[length] = a;
      kept[length + 1] = b;
      kept[length + 2] = c;
      length += 3;
    }
    if (length === indices.length) meshes.push(mesh);
    else if (length) meshes.push({ ...mesh, indices: kept.slice(0, length) });
  }
  return meshes.length === drawable.meshes.length && meshes.every((mesh, index) => mesh === drawable.meshes[index]) ? drawable : { ...drawable, meshes };
}

/* Сетка поиска ближайшей вершины: клетка 8 см, поиск идёт кольцами, пока не найдётся вершина. */
const CELL = 0.08;
const MAX_RING = 12;

function vertexGrid(references) {
  const grid = new Map();
  for (const drawable of references)
    for (const mesh of drawable?.meshes || []) {
      if (!mesh.skin) continue;
      const vertices = mesh.positions.length / 3;
      for (let vertex = 0; vertex < vertices; vertex += 1) {
        const key = numericKey(Math.floor(mesh.positions[vertex * 3] / CELL), Math.floor(mesh.positions[vertex * 3 + 1] / CELL), Math.floor(mesh.positions[vertex * 3 + 2] / CELL));
        let cell = grid.get(key);
        if (!cell) grid.set(key, (cell = []));
        cell.push(mesh, vertex);
      }
    }
  return grid;
}

function nearestVertex(grid, x, y, z) {
  const [cx, cy, cz] = [Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL)];
  let best = null;
  let bestVertex = -1;
  let bestDistance = Infinity;
  for (let ring = 0; ring <= MAX_RING; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1)
      for (let dy = -ring; dy <= ring; dy += 1)
        for (let dz = -ring; dz <= ring; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
          const cell = grid.get(numericKey(cx + dx, cy + dy, cz + dz));
          if (!cell) continue;
          for (let at = 0; at < cell.length; at += 2) {
            const mesh = cell[at];
            const vertex = cell[at + 1];
            const distance = (mesh.positions[vertex * 3] - x) ** 2 + (mesh.positions[vertex * 3 + 1] - y) ** 2 + (mesh.positions[vertex * 3 + 2] - z) ** 2;
            if (distance < bestDistance) {
              bestDistance = distance;
              best = mesh;
              bestVertex = vertex;
            }
          }
        }
    /* Вершина в следующем кольце может быть ближе, но не дальше чем на клетку: одно кольцо сверх найденного закрывает это. */
    if (best && bestDistance <= (ring * CELL) ** 2) break;
  }
  return best ? { mesh: best, vertex: bestVertex } : null;
}

/** Есть ли у вещи сетки без весов: такие стоят в позе привязки, что бы ни делал персонаж. */
export const lacksSkin = (drawable) => Boolean(drawable?.meshes?.some((mesh) => !mesh.skin && mesh.positions?.length));

/**
 * Веса ближайших вершин тела — сеткам вещи, у которых их нет. `references` — части тела с весами в позе привязки. Нет ни одной вершины рядом — сетка остаётся как есть.
 */
export function withBodySkin(drawable, references) {
  if (!lacksSkin(drawable)) return drawable;
  const grid = vertexGrid(references);
  if (!grid.size) return drawable;
  return {
    ...drawable,
    meshes: drawable.meshes.map((mesh) => {
      if (mesh.skin || !mesh.positions?.length) return mesh;
      const vertices = mesh.positions.length / 3;
      const joints = new Uint16Array(vertices * 4);
      const weights = new Float32Array(vertices * 4);
      for (let vertex = 0; vertex < vertices; vertex += 1) {
        const near = nearestVertex(grid, mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
        if (!near) continue;
        for (let slot = 0; slot < 4; slot += 1) {
          joints[vertex * 4 + slot] = near.mesh.skin.joints[near.vertex * 4 + slot];
          weights[vertex * 4 + slot] = near.mesh.skin.weights[near.vertex * 4 + slot];
        }
      }
      return { ...mesh, skin: { joints, weights } };
    }),
  };
}
