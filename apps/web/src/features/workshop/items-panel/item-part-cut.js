import { arenaPartTriangles } from "@modovik/climb-contract/recolor/arena-item-looks";

// Рамка части хранится с точностью до десятитысячных метра.
const BOX_GRID = 10000;

const hasGeometry = (mesh) =>
  Boolean(
    mesh &&
      mesh.positions &&
      mesh.positions.length > 0 &&
      mesh.indices &&
      mesh.indices.length >= 3,
  );

const snapBox = (value) => Math.round(value * BOX_GRID) / BOX_GRID + 0;

// Обратный ход места вещи: вычесть положение, повернуть обратным
// кватернионом (без нормировки), поделить на масштаб.
function modelSpaceMapper(place) {
  const [px, py, pz] = place.position;
  const [qx, qy, qz, qw] = place.rotation;
  const [planeScale, heightScale] = place.scale;
  const ux = -qx;
  const uy = -qy;
  const uz = -qz;

  return (x, y, z, out, at) => {
    const rx = x - px;
    const ry = y - py;
    const rz = z - pz;
    const tx = 2 * (uy * rz - uz * ry);
    const ty = 2 * (uz * rx - ux * rz);
    const tz = 2 * (ux * ry - uy * rx);
    out[at] = (rx + qw * tx + (uy * tz - uz * ty)) / planeScale;
    out[at + 1] = (ry + qw * ty + (uz * tx - ux * tz)) / planeScale;
    out[at + 2] = (rz + qw * tz + (ux * ty - uy * tx)) / heightScale;
  };
}

// Все годные сетки вещи одним набором в осях модели.
function weldInModelSpace(meshes, place) {
  const toModel = modelSpaceMapper(place);
  const slots = [];
  let vertexTotal = 0;
  let triangleTotal = 0;
  for (const mesh of meshes) {
    if (!hasGeometry(mesh)) continue;
    const vertices = Math.floor(mesh.positions.length / 3);
    const triangles = Math.floor(mesh.indices.length / 3);
    slots.push({
      mesh,
      vertices,
      triangles,
      firstVertex: vertexTotal,
      firstTriangle: triangleTotal,
    });
    vertexTotal += vertices;
    triangleTotal += triangles;
  }

  const positions = new Float32Array(vertexTotal * 3);
  const indices = new Uint32Array(triangleTotal * 3);
  // Повторный номер сетки затирает прежнюю запись.
  const startOf = new Map();
  for (const slot of slots) {
    const { mesh } = slot;
    for (let v = 0; v < slot.vertices; v += 1) {
      const from = v * 3;
      toModel(
        mesh.positions[from],
        mesh.positions[from + 1],
        mesh.positions[from + 2],
        positions,
        (slot.firstVertex + v) * 3,
      );
    }
    const shift = slot.firstVertex;
    const base = slot.firstTriangle * 3;
    for (let at = 0, end = slot.triangles * 3; at < end; at += 1) {
      indices[base + at] = mesh.indices[at] + shift;
    }
    startOf.set(mesh.meshIndex, slot.firstTriangle);
  }
  return { slots, positions, indices, startOf, triangleTotal };
}

// Рамка части по её диапазонам; null, если ни одной вершины не набралось.
function boundsOfRuns(runs, set) {
  const { positions, indices, startOf, triangleTotal } = set;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at + 2 < runs.length; at += 3) {
    const first = startOf.get(runs[at]);
    if (first === undefined) continue;
    const from = Math.max(first + runs[at + 1], 0);
    const to = Math.min(first + runs[at + 2], triangleTotal);
    for (let tri = from; tri < to; tri += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = indices[tri * 3 + corner] * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          const value = positions[vertex + axis];
          if (value < low[axis]) low[axis] = value;
          if (value > high[axis]) high[axis] = value;
        }
      }
    }
  }
  if (low[0] === Infinity) return null;
  return [low.map(snapBox), high.map(snapBox)];
}

// Маска правила установщика обратно в диапазоны сеток.
function runsOfMask(mask, set) {
  const { slots } = set;
  const flat = [];
  let selected = 0;
  let slotAt = 0;
  let open = null;
  for (let tri = 0; tri < mask.length; tri += 1) {
    if (!mask[tri]) continue;
    while (
      slotAt < slots.length &&
      tri >= slots[slotAt].firstTriangle + slots[slotAt].triangles
    ) {
      slotAt += 1;
    }
    if (slotAt >= slots.length) break;
    const slot = slots[slotAt];
    const local = tri - slot.firstTriangle;
    selected += 1;
    if (open && open.meshIndex === slot.mesh.meshIndex && open.end === local) {
      open.end += 1;
      flat[open.at] += 1;
    } else {
      open = { meshIndex: slot.mesh.meshIndex, end: local + 1, at: flat.length + 2 };
      flat.push(slot.mesh.meshIndex, local, local + 1);
    }
  }
  return { runs: Int32Array.from(flat), triangles: selected };
}

function cutPart(part, set) {
  const box = boundsOfRuns(part.runs, set);
  if (!box) return { ...part, own: part.runs, box: null };
  const { runs, triangles } = runsOfMask(
    arenaPartTriangles(set.positions, set.indices, box),
    set,
  );
  return { ...part, own: part.runs, runs, triangles, box };
}

export function cutItemParts(meshes, parts, place) {
  if (!place || !parts || !(parts.length >= 2)) return parts;
  const set = weldInModelSpace(meshes, place);
  return parts.map((part) => cutPart(part, set));
}
