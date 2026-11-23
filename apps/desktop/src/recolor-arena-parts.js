import zlib from "node:zlib";
import { readDrawable } from "@modovik/rage-drawable";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { deflateRaw } from "@modovik/native-rs";
import { arenaPartTriangles } from "@modovik/climb-contract/recolor/arena-item-looks";
import {
  itemElementFront,
  itemElementMeshesPlaced,
  itemElementPlane,
  itemElementProjectedUvs,
  itemElementProjection,
  itemMeshesFrame,
} from "@modovik/climb-contract/recolor/item-elements";
import { inflateRaw } from "./recolor-sheets.js";

export const PART_VERTEX_LIMIT = 60000;

const DETAIL_ORDER = ["high", "medium", "low", "veryLow"];
const PLAIN_DATA_LIMIT = 8388608;
const FAST_LEVEL = 6;
const JACOBI_PASSES = 32;
const JACOBI_PAIRS = [[0, 1], [0, 2], [1, 2]];
const AXES = [0, 1, 2];

// Малая векторная арифметика: порядок действий важен для последних знаков.
const Vec = {
  dot: (a, b) => AXES.map((i) => a[i] * b[i]).reduce((x, y) => x + y),
  sub: (a, b) => a.map((value, k) => value - b[k]),
  neg: (v) => v.map((x) => -x),
  unit(v) {
    const length = Math.hypot(...v) || 1;
    return v.map((x) => x / length);
  },
  cross: (a, b) => AXES.map((i) => {
    const [j, k] = [(i + 1) % 3, (i + 2) % 3];
    return a[j] * b[k] - a[k] * b[j];
  }),
};

const asBytes = (input) => (input instanceof Uint8Array ? input : new Uint8Array(input));
const openModel = (bytes) => openResourceWith(asBytes(bytes), inflateRaw);

// Ось ступени (x, y, z) -> ось модели (x, -z, y); Z модели смотрит вверх.
function stageToModel(source, target, offset) {
  for (let at = 0; at < source.length; at += 3) {
    const point = [source[at], -source[at + 2], source[at + 1]];
    [target[offset + at], target[offset + at + 1], target[offset + at + 2]] = point;
  }
  return target;
}

const modelCopy = (source) => stageToModel(source, new Float64Array(source.length), 0);

// Сетки одной ступени: с целым смещением индексов и только первая с таким смещением.
function* walkMeshes(resource, lod) {
  const seen = new Set();
  for (const drawable of readDrawable(resource, { inflateRaw, lod }).drawables) {
    for (const mesh of drawable.meshes) {
      const at = mesh.indicesAt;
      if (!Number.isInteger(at) || seen.has(at)) continue;
      seen.add(at);
      yield mesh;
    }
  }
}

// Одна сетка внутри ступени: где её вершины и треугольники в общих списках.
class Span {
  constructor(mesh, vertexBase, first, triangles) {
    Object.assign(this, { mesh, at: mesh.indicesAt, vertexBase, first, triangles });
  }

  write(positions, indices) {
    stageToModel(this.mesh.positions, positions, this.vertexBase * 3);
    for (let k = 0; k < this.triangles * 3; k++) {
      indices[this.first * 3 + k] = this.mesh.indices[k] + this.vertexBase;
    }
  }

  // Треугольники части в порядке файла: номер в сетке и тройка индексов.
  * picked(mask) {
    for (let t = 0; t < this.triangles; t++) {
      if (mask[this.first + t]) yield { t, corners: AXES.map((corner) => this.mesh.indices[t * 3 + corner]) };
    }
  }

  // Строка вершины сетки части: точка, нормаль, развёртка.
  vertex(old) {
    const { mesh } = this;
    const p = old * 3;
    return [
      mesh.positions[p], -mesh.positions[p + 2], mesh.positions[p + 1],
      ...(mesh.normals ? [mesh.normals[p], -mesh.normals[p + 2], mesh.normals[p + 1]] : [0, 0, 1]),
      ...(mesh.uvs ? [mesh.uvs[old * 2], mesh.uvs[old * 2 + 1]] : [0, 0]),
    ];
  }

  // Свести каждый отмеченный треугольник в точку: второй и третий индексы равны первому.
  collapse(view, mask) {
    let done = 0;
    for (const { t, corners: [lead] } of this.picked(mask)) {
      [2, 4].forEach((shift) => view.setUint16(this.at + t * 6 + shift, lead, true));
      done += 1;
    }
    return done;
  }
}

// Ступень детализации открытой модели: общие вершины, индексы и маска части.
class Level {
  constructor(resource, lod) {
    let vertexBase = 0;
    let first = 0;
    this.spans = [...walkMeshes(resource, lod)].map((mesh) => {
      const triangles = Math.floor(mesh.indices.length / 3);
      const span = new Span(mesh, vertexBase, first, triangles);
      vertexBase += mesh.positions.length / 3;
      first += triangles;
      return span;
    });
    this.triangleTotal = first;
    this.positions = new Float64Array(vertexBase * 3);
    this.indices = new Uint32Array(first * 3);
    this.spans.forEach((span) => span.write(this.positions, this.indices));
  }

  mask(boxes) {
    const mask = new Uint8Array(this.triangleTotal);
    for (const box of boxes) {
      const flags = arenaPartTriangles(this.positions, this.indices, box);
      mask.forEach((_, t) => {
        mask[t] |= flags[t];
      });
    }
    return mask;
  }

  // Сколько треугольников сведено; смещение, уже виденное на любой ступени, пропускается.
  collapse(view, handled, mask) {
    return this.spans.reduce((total, span) => {
      if (handled.has(span.at)) return total;
      handled.add(span.at);
      return total + span.collapse(view, mask);
    }, 0);
  }
}

// Файл модели заново: заголовок входа как есть, дальше сжатые данные ресурса.
function repack(source, data) {
  const level = data.length > PLAIN_DATA_LIMIT ? FAST_LEVEL : zlib.constants.Z_BEST_COMPRESSION;
  const packed = deflateRaw(data, { level });
  const file = Buffer.alloc(RSC7_HEADER_BYTES + packed.length);
  [[Buffer.from(source.buffer, source.byteOffset, RSC7_HEADER_BYTES), 0], [packed, RSC7_HEADER_BYTES]]
    .forEach(([part, at]) => file.set(part, at));
  return file;
}

export function cutParts(bytes, boxes) {
  const source = asBytes(bytes);
  const resource = openResourceWith(source, inflateRaw);
  const view = new DataView(resource.data.buffer, resource.data.byteOffset, resource.data.byteLength);
  const handled = new Set();
  const removed = DETAIL_ORDER.reduce((total, lod) => {
    const level = new Level(resource, lod);
    return total + level.collapse(view, handled, level.mask(boxes));
  }, 0);
  return removed ? { bytes: repack(source, resource.data), removed } : { bytes: null, removed: 0 };
}

// ---------------------------------------------------------------- сетка части

const column = (rows, from, width) => Float32Array.from(rows.flatMap((row) => row.slice(from, from + width)));

export function partMesh(bytes, box) {
  const level = new Level(openModel(bytes), "high");
  const mask = level.mask([box]);

  const rows = [];
  const indices = [];
  for (const span of level.spans) {
    const known = new Map();
    for (const { corners } of span.picked(mask)) {
      for (const old of corners) {
        if (!known.has(old)) {
          known.set(old, rows.length);
          rows.push(span.vertex(old));
        }
        indices.push(known.get(old));
      }
    }
  }
  if (!indices.length) return null;

  const positions = column(rows, 0, 3);
  const extreme = (pick, start) => AXES.map((axis) => positions
    .filter((_, at) => at % 3 === axis)
    .reduce((best, value) => pick(best, value), start));
  return {
    positions,
    normals: column(rows, 3, 3),
    uvs: column(rows, 6, 2),
    indices: Uint32Array.from(indices),
    bounds: { min: extreme(Math.min, Infinity), max: extreme(Math.max, -Infinity) },
  };
}

// ---------------------------------------------------------------- элемент вещи

const leafName = (mesh) => String(mesh.material?.textures?.diffuse || "").toLowerCase();

export function elementMeshes(bytes, texture) {
  return [...walkMeshes(openModel(bytes), "high")].flatMap((mesh) => {
    if (mesh.uvs == null || leafName(mesh) !== texture) return [];
    return [{
      positions: modelCopy(mesh.positions),
      normals: mesh.normals ? modelCopy(mesh.normals) : null,
      uvs: mesh.uvs,
      indices: mesh.indices.subarray(0, Math.floor(mesh.indices.length / 3) * 3),
    }];
  });
}

export function modelFrame(bytes, place = null) {
  const shapes = [...walkMeshes(openModel(bytes), "high")].map((mesh) => ({ positions: modelCopy(mesh.positions) }));
  return itemMeshesFrame(itemElementMeshesPlaced(shapes, place));
}

// Одна сетка из всех сеток элемента: позиции без расстановки, развёртка — от соседа.
function mergeElement(meshes, uvLists) {
  const total = (pick) => meshes.reduce((sum, mesh) => sum + pick(mesh), 0);
  const floats = total((mesh) => mesh.positions.length);
  const merged = {
    positions: new Float32Array(floats),
    normals: new Float32Array(floats),
    uvs: new Float32Array((floats / 3) * 2),
    indices: new Uint32Array(total((mesh) => mesh.indices.length)),
  };
  let vertexBase = 0;
  let indexBase = 0;
  meshes.forEach((mesh, order) => {
    merged.positions.set(mesh.positions, vertexBase * 3);
    if (mesh.normals) merged.normals.set(mesh.normals, vertexBase * 3);
    merged.uvs.set(uvLists[order], vertexBase * 2);
    Array.from(mesh.indices, (index) => index + vertexBase).forEach((index, k) => {
      merged.indices[indexBase + k] = index;
    });
    vertexBase += mesh.positions.length / 3;
    indexBase += mesh.indices.length;
  });
  return merged;
}

function projectElement(meshes, bytes, place, around) {
  const placed = itemElementMeshesPlaced(meshes, place);
  const front = itemElementFront(place);
  const frame = modelFrame(bytes, place);
  const plane = [
    () => itemElementProjection(placed, { front, frame, around }),
    () => itemElementPlane(placed),
  ].reduce((found, ask) => found || ask(), null);
  return plane ? { mesh: mergeElement(meshes, itemElementProjectedUvs(placed, plane)), plane } : null;
}

export function elementProjectedMesh(bytes, texture, place = null, around = false) {
  const meshes = elementMeshes(bytes, texture);
  return meshes.length ? projectElement(meshes, bytes, place, around) : null;
}

// ---------------------------------------------------------------- плоскость части

// Грани с ненулевой площадью: площадь, середина, неединичная нормаль (длина — две площади).
function* faceStream(mesh) {
  const indices = mesh.indices;
  const positions = mesh.positions;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const [a, b, c] = AXES.map((n) => AXES.map((k) => positions[indices[at + n] * 3 + k]));
    const normal = Vec.cross(Vec.sub(b, a), Vec.sub(c, a));
    const area = Math.hypot(...normal) / 2;
    if (area > 0) yield { area, normal, mid: a.map((value, k) => (value + b[k] + c[k]) / 3) };
  }
}

// Вращения Якоби над симметричной матрицей 3 x 3 (плоский список по строкам).
function jacobiEigen(matrix) {
  const m = matrix.flat();
  const vectors = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const twist = (target, first, second, step, c, s) => {
    for (const n of AXES) {
      const [i, j] = [first + n * step, second + n * step];
      [target[i], target[j]] = [c * target[i] - s * target[j], s * target[i] + c * target[j]];
    }
  };
  const size = ([row, col]) => Math.abs(m[row * 3 + col]);
  for (let pass = 0; pass < JACOBI_PASSES; pass++) {
    const pivot = JACOBI_PAIRS.slice(1).reduce(
      (best, pair) => (size(pair) > best.size ? { pair, size: size(pair) } : best),
      { pair: JACOBI_PAIRS[0], size: size(JACOBI_PAIRS[0]) },
    );
    if (pivot.size < 1e-12) break;
    const [p, q] = pivot.pair;
    const theta = (m[q * 4] - m[p * 4]) / (2 * m[p * 3 + q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;
    twist(m, p, q, 3, c, s);
    twist(m, p * 3, q * 3, 1, c, s);
    twist(vectors, p, q, 3, c, s);
  }
  return { diagonal: [m[0], m[4], m[8]], vectors };
}

export function partPlane(mesh) {
  const faces = [...faceStream(mesh)];
  if (!faces.length) return null;

  const totalArea = faces.reduce((sum, face) => sum + face.area, 0);
  const centre = AXES.map((k) => faces.reduce((sum, face) => sum + face.mid[k] * face.area, 0) / totalArea);
  const offsets = faces.map((face) => Vec.sub(face.mid, centre));
  const spread = AXES.map((i) => AXES.map((j) => faces.reduce(
    (sum, face, n) => sum + offsets[n][i] * offsets[n][j] * face.area / totalArea,
    0,
  )));

  const { diagonal, vectors } = jacobiEigen(spread);
  const thin = [1, 2].reduce((best, k) => (diagonal[k] < diagonal[best] ? k : best), 0);
  const wide = [1, 2].reduce((best, k) => (diagonal[k] > diagonal[best] ? k : best), 0);
  let normal = Vec.unit(AXES.map((row) => vectors[row * 3 + thin]));

  // Лицо: куда смотрит большая часть граней; у двустороннего полотна — от начала осей к середине.
  const lean = faces.reduce((sum, face) => sum + Vec.dot(face.normal, normal), 0);
  const areaTwice = faces.reduce((sum, face) => sum + 2 * face.area, 0);
  const turnAround = Math.abs(lean) > 0.1 * areaTwice ? lean < 0 : Vec.dot(centre, normal) < 0;
  if (turnAround) normal = Vec.neg(normal);

  const vertical = [[0, 0, 1], [0, 1, 0]][Number(Math.abs(normal[2]) > 0.9)];
  const along = Vec.dot(vertical, normal);
  const up = Vec.unit(vertical.map((value, k) => value - along * normal[k]));
  const right = Vec.cross(Vec.neg(normal), up);

  const [thickness, extent] = [thin, wide].map((k) => 2 * Math.sqrt(Math.max(0, diagonal[k])));
  const flat = thickness < 0.03 || thickness < 0.05 * extent;
  return { normal, right, up, flat, centre };
}

// ---------------------------------------------------------------- развёртка проекцией

// Пропорция картинки годится, если это конечное положительное число (без приведения типов).
const usableAspect = (aspect, fallback) => (Number.isFinite(aspect) && aspect > 0 ? aspect : fallback);

export function projectPartUvs(mesh, aspect, plane = partPlane(mesh)) {
  if (!plane) return mesh;
  const positions = mesh.positions;
  const count = positions.length / 3;
  const coords = Array.from({ length: Math.ceil(count) }, (_, i) => {
    const point = AXES.map((k) => positions[i * 3 + k]);
    return [Vec.dot(point, plane.right), Vec.dot(point, plane.up)];
  });
  const [acrossAll, alongAll] = [0, 1].map((n) => coords.map((pair) => pair[n]));
  const left = Math.min(...acrossAll);
  const top = Math.max(...alongAll);
  const width = Math.max(Math.max(...acrossAll) - left, 1e-6);
  const height = Math.max(top - Math.min(...alongAll), 1e-6);

  const partAspect = width / height;
  const imageAspect = usableAspect(aspect, partAspect);
  const fit = imageAspect > partAspect
    ? (u, v) => [0.5 + (u - 0.5) * (partAspect / imageAspect), v]
    : (u, v) => [u, 0.5 + (v - 0.5) * (imageAspect / partAspect)];
  const uvs = new Float32Array(count * 2);
  coords.forEach(([across, along], i) => {
    [uvs[i * 2], uvs[i * 2 + 1]] = fit((across - left) / width, (top - along) / height);
  });
  return { ...mesh, uvs };
}

// ---------------------------------------------------------------- обратные грани

// Массив в два раза длиннее: вторая половина — копия (при желании — преобразованная).
function twinned(source, length, offset, change) {
  const out = new Float32Array(length);
  out.set(source);
  out.set(change ? Array.from(source, change) : source, offset);
  return out;
}

export function withBackFaces(mesh) {
  const floats = mesh.positions.length;
  const vertices = floats / 3;
  const positions = twinned(mesh.positions, floats * 2, floats);
  const normals = twinned(mesh.normals, floats * 2, floats, (x) => -x);
  const uvs = twinned(mesh.uvs, vertices * 4, vertices * 2);

  const half = mesh.indices.length;
  const indices = new Uint32Array(half * 2);
  indices.set(mesh.indices);
  const reversed = Array.from({ length: Math.floor(half / 3) }, (_, tri) => {
    const [a, b, c] = AXES.map((n) => mesh.indices[tri * 3 + n] + vertices);
    return [a, c, b];
  });
  indices.set(reversed.flat(), half);
  return { ...mesh, positions, normals, uvs, indices };
}
