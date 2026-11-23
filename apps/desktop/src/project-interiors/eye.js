/*
 * «Интерьеры проектов» — где стоит глаз в кадре интерьера.
 *
 * Кадр изнутри начинается с точки зала: в центре рамки комнат она часто
 * приходится на стену (у Г-образной комнаты) или в мебель. Точку берёт сама
 * сцена: кандидаты — самые большие участки пола (грани вверх), у каждого
 * на высоте глаза пускаются лучи в стороны и вверх; выигрывает тот, у кого
 * ближайшая стена дальше всего, а над головой есть потолок. Смотрит глаз туда, где зал длиннее всего.
 *
 * Лучи — перебором по граням непрозрачной геометрии с отсевом по рамкам
 * сеток: десятки лучей на сотни тысяч граней — доли секунды, и сцена
 * собирается раз (потом лежит в кэше).
 */

const EYE_HEIGHT = 1.65;
const MIN_HEADROOM = 0.35;
const CEILING_FAR = 6;
const CANDIDATES = 36;
const RAYS = 8;
const FAR = 8;

const solid = (material) => Boolean(material) && (material.alpha === "opaque" || material.alpha === "cutout") && !material.decal && !material.dirt;

/* Сетки, что держат глаз и взгляд: непрозрачные, с рамкой для отсева лучей. */
function solids(built) {
  const out = [];
  for (const mesh of built.meshes) {
    if (!solid(built.materials[mesh.material]) || !mesh.indices?.length) continue;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < mesh.positions.length; at += 3)
      for (let axis = 0; axis < 3; axis += 1) {
        const value = mesh.positions[at + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    out.push({ positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, min, max });
  }
  return out;
}

/* Луч в рамку: ближайшее пересечение не дальше `limit` или `false`. */
function boxHit(origin, direction, box, limit) {
  let near = 0;
  let far = limit;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return false;
      continue;
    }
    let a = (box.min[axis] - origin[axis]) / direction[axis];
    let b = (box.max[axis] - origin[axis]) / direction[axis];
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return false;
  }
  return true;
}

/* Расстояние до ближайшей грани по лучу (Мёллер — Трамбор, грань двусторонняя) или `Infinity`. */
function cast(origin, direction, list, limit = FAR) {
  let best = limit;
  for (const mesh of list) {
    if (!boxHit(origin, direction, mesh, best)) continue;
    const { positions, indices } = mesh;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = indices[at] * 3;
      const b = indices[at + 1] * 3;
      const c = indices[at + 2] * 3;
      const e1x = positions[b] - positions[a];
      const e1y = positions[b + 1] - positions[a + 1];
      const e1z = positions[b + 2] - positions[a + 2];
      const e2x = positions[c] - positions[a];
      const e2y = positions[c + 1] - positions[a + 1];
      const e2z = positions[c + 2] - positions[a + 2];
      const px = direction[1] * e2z - direction[2] * e2y;
      const py = direction[2] * e2x - direction[0] * e2z;
      const pz = direction[0] * e2y - direction[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det;
      const tx = origin[0] - positions[a];
      const ty = origin[1] - positions[a + 1];
      const tz = origin[2] - positions[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-4 && t < best) best = t;
    }
  }
  return best;
}

/* Самые большие участки пола: центры граней вверх, не ближе метра друг к другу. */
function floorSpots(list) {
  const spots = [];
  for (const { positions, normals, indices } of list)
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
      const size = 0.5 * Math.hypot(nx, ny, nz);
      if (size < 0.4) continue;
      /* Пол — грань, что смотрит вверх: по нормалям вершин, а без них — по самой грани. */
      const up = normals ? (normals[a + 2] + normals[b + 2] + normals[c + 2]) / 3 : nz / (2 * size);
      if (up < 0.85) continue;
      spots.push({ size, x: (positions[a] + positions[b] + positions[c]) / 3, y: (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3, z: (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3 });
    }
  spots.sort((x, y) => y.size - x.size);
  const picked = [];
  for (const spot of spots) {
    if (picked.length >= CANDIDATES) break;
    if (picked.every((other) => Math.hypot(other.x - spot.x, other.y - spot.y, other.z - spot.z) > 1)) picked.push(spot);
  }
  return picked;
}

/**
 * Глаз для сцены: `{ eye: [x, y, z], yaw, pitch }` или `null`, если пола в
 * сцене не нашлось. Оси — игры (Z вверх), `yaw` — как у кадра:
 * направление взгляда `(sin yaw, cos yaw)`.
 */
export function findEye(built) {
  const list = solids(built);
  let best = null;
  for (const spot of floorSpots(list)) {
    const eye = [spot.x, spot.y, spot.z + EYE_HEIGHT];
    /* Над глазами потолок (не вплотную и не выше шести метров от глаз): пол на крыше колонны, под открытым небом или в комнате ниже роста — не зал. */
    const ceiling = cast(eye, [0, 0, 1], list, CEILING_FAR);
    if (ceiling < MIN_HEADROOM || ceiling >= CEILING_FAR) continue;
    const ring = [];
    for (let step = 0; step < RAYS; step += 1) {
      const angle = (step / RAYS) * Math.PI * 2;
      ring.push({ yaw: angle, distance: cast(eye, [Math.sin(angle), Math.cos(angle), 0], list) });
    }
    const nearest = Math.min(...ring.map((item) => item.distance));
    const mean = ring.reduce((sum, item) => sum + item.distance, 0) / ring.length;
    const score = nearest + mean * 0.1;
    if (!best || score > best.score) best = { score, eye, yaw: ring.reduce((far, item) => (item.distance > far.distance ? item : far)).yaw };
  }
  if (!best) return null;
  return { eye: best.eye.map((value) => Math.round(value * 100) / 100), yaw: Math.round(best.yaw * 1000) / 1000, pitch: 0 };
}
