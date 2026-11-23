/*
 * Границы моделей зала в метрах (оси игры, Z вверх) — 12.11.2026, «звезда автора в кадре арены Majestic».
 *
 * Свои модели автора Majestic (статуи, трон, стена стволов у ALLIANCE V3) «запечены»: сущность стоит в начале координат (0; 0; 0), а вершины модели уже
 * лежат на своих местах в интерьере. Место такой модели — не позиция сущности, а границы её сетки: по ним зал ищет звезду и ставит камеру
 * (`arena-star-target.js`, `arena-showcase.js`, `arena-view-plan.js`).
 */

const asBuffer = (glb) => (Buffer.isBuffer(glb) ? glb : ArrayBuffer.isView(glb) ? Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength) : Buffer.from(glb));

/* Матрица узла GLB (по столбцам): `matrix` или поворот, масштаб и сдвиг. */
function nodeMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(left, right) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1) for (let k = 0; k < 4; k += 1) out[column * 4 + row] += left[k * 4 + row] * right[column * 4 + k];
  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Границы модели по её GLB — `{ min: [x, y, z], max: [x, y, z] }` в осях игры (Z вверх, узлы применены) или `null`, если GLB не прочитался
 * или у вершин нет границ (`accessor.min/max`).
 */
export function glbBounds(glb) {
  try {
    const bytes = asBuffer(glb);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const take = (matrix, box) => {
      for (let corner = 0; corner < 8; corner += 1) {
        const x = corner & 1 ? box.max[0] : box.min[0];
        const y = corner & 2 ? box.max[1] : box.min[1];
        const z = corner & 4 ? box.max[2] : box.min[2];
        const gx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
        const gy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
        const gz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
        /* Y-вверх GLB → Z-вверх игры. */
        const game = [gx, -gz + 0, gy];
        for (let axis = 0; axis < 3; axis += 1) {
          if (game[axis] < min[axis]) min[axis] = game[axis];
          if (game[axis] > max[axis]) max[axis] = game[axis];
        }
      }
    };
    const walk = (index, parent, seen) => {
      const node = json.nodes?.[index];
      if (!node || seen.has(index)) return;
      const world = multiply(parent, nodeMatrix(node));
      const next = new Set(seen).add(index);
      for (const child of node.children || []) walk(child, world, next);
      if (!Number.isInteger(node.mesh)) return;
      for (const primitive of json.meshes?.[node.mesh]?.primitives || []) {
        const box = json.accessors?.[primitive.attributes?.POSITION];
        if (box?.min?.length === 3 && box?.max?.length === 3) take(world, box);
      }
    };
    const roots = json.scenes?.[json.scene ?? 0]?.nodes || (json.nodes || []).map((_, index) => index);
    for (const root of roots) walk(root, IDENTITY, new Set());
    return min.every(Number.isFinite) && max.every(Number.isFinite) ? { min, max } : null;
  } catch {
    return null;
  }
}

/** Границы детали после размещения сущности: масштаб `{ xy, z }`, поворот кватернионом, сдвиг (так же ставит деталь сцена зала). */
export function placedBounds(box, placement) {
  if (!box) return null;
  const { x: qx = 0, y: qy = 0, z: qz = 0, w: qw = 1 } = placement?.rotation || {};
  const [sx, sy, sz] = placement?.scale ? [placement.scale.xy, placement.scale.xy, placement.scale.z] : [1, 1, 1];
  const at = placement?.position || { x: 0, y: 0, z: 0 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner += 1) {
    const x = (corner & 1 ? box.max[0] : box.min[0]) * sx;
    const y = (corner & 2 ? box.max[1] : box.min[1]) * sy;
    const z = (corner & 4 ? box.max[2] : box.min[2]) * sz;
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    const moved = [
      x + qw * tx + (qy * tz - qz * ty) + at.x,
      y + qw * ty + (qz * tx - qx * tz) + at.y,
      z + qw * tz + (qx * ty - qy * tx) + at.z,
    ];
    for (let axis = 0; axis < 3; axis += 1) {
      if (moved[axis] < min[axis]) min[axis] = moved[axis];
      if (moved[axis] > max[axis]) max[axis] = moved[axis];
    }
  }
  return { min, max };
}

export const boundsCentre = (box) => box.min.map((value, axis) => (value + box.max[axis]) / 2);
export const boundsExtent = (box) => box.min.map((value, axis) => box.max[axis] - value);
export const boundsSize = (box) => Math.max(...boundsExtent(box));

/** Расстояние между двумя коробками, м (0 — пересекаются). */
export function boundsGap(left, right) {
  let sum = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const gap = Math.max(0, left.min[axis] - right.max[axis], right.min[axis] - left.max[axis]);
    sum += gap * gap;
  }
  return Math.sqrt(sum);
}

/** Коробка, охватывающая все `boxes`; `null` для пустого списка. */
export function mergeBounds(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  return {
    min: [0, 1, 2].map((axis) => Math.min(...list.map((box) => box.min[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...list.map((box) => box.max[axis]))),
  };
}
