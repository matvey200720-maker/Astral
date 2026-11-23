// Мост между сетками three.js и числовыми функциями развёртки (gun-uv.js).
import { vertexParts, uvIslands } from "./gun-uv.js";
import * as THREE from "three";

const assignMeshParts = (root, options = {}) => {
  const { skip = () => false } = options;
  if (root === null || root === undefined) return 0;
  const meshes = [];
  root.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  // номера деталей сквозные: каждая сетка начинает с числа уже выданных
  return meshes.reduce(
    (issued, mesh) => (skip(mesh) ? issued : issued + numberParts(mesh.geometry, issued)),
    0,
  );
};

const meshUvIslands = (geometry) => {
  const [position, uv] = ["position", "uv"].map((name) => attributeOf(geometry, name));
  if (!position || !uv) return null;
  return uvIslands(layout(geometry, [[position, PLACE_AXES], [uv, SHEET_AXES]]));
};

const partUvTriangles = (meshes, mapper) => {
  const numbers = [];
  const project = uvProjector(Object(mapper).matrix ?? new THREE.Matrix3(), numbers);
  [...(meshes || [])].forEach((record) => {
    const { mesh, groups } = record;
    const uv = attributeOf(mesh?.geometry, "uv");
    if (!uv) return;
    const vertexAt = vertexLookup(mesh.geometry);
    rangesOf(mesh.geometry, uv, groups).forEach(([from, to]) => {
      let at = from;
      while (at + 2 < to) {
        project(uv, vertexAt(at));
        project(uv, vertexAt(at + 1));
        project(uv, vertexAt(at + 2));
        at += 3;
      }
    });
  });
  return Float32Array.from(numbers);
};

export { assignMeshParts, meshUvIslands, partUvTriangles };

// ---- чтение геометрии -----------------------------------------------------

function attributeOf(geometry, name) {
  return geometry?.attributes?.[name] || null;
}

// Числа вершин подряд в одном Float64Array: по столбцу на каждую ось каждого источника.
// Читаются расшифрованные значения (getX/getY/getZ), не сырые целые.
function layout(geometry, sources) {
  const readers = sources.flatMap(([attribute, axes]) => axes.map((axis) => (vertex) => attribute[axis](vertex)));
  const vertexCount = sources[0][0].count;
  const values = new Float64Array(vertexCount * readers.length);
  readers.forEach((read, column) => {
    let vertex = 0;
    for (let at = column; at < values.length; at += readers.length) values[at] = read(vertex++);
  });
  return { indices: geometry.index?.array ?? null, vertexCount, values, stride: readers.length };
}

function numberParts(geometry, offset) {
  const position = attributeOf(geometry, "position");
  if (!position) return 0;
  const { parts, count } = vertexParts(layout(geometry, [[position, PLACE_AXES]]));
  const labelled = new Float32Array(parts.length);
  parts.forEach((part, vertex) => {
    labelled[vertex] = part + offset;
  });
  geometry.setAttribute(PART_ATTRIBUTE, scalarAttribute(labelled));
  return count;
}

function scalarAttribute(array) {
  return new THREE.BufferAttribute(array, 1);
}

// ---- развёртка детали -----------------------------------------------------

// Номер вершины по позиции в списке индексов (без индекса - сама позиция).
function vertexLookup({ index }) {
  return index ? (place) => index.getX(place) : (place) => place;
}

function rangesOf({ index }, uv, groups) {
  const length = (index || uv).count;
  if (!groups?.length) return [[0, length]];
  return Array.from(groups).map(({ start, count }) => [start, Math.min(start + count, length)]);
}

// Точка развёртки, прогнанная через матрицу текстуры, дописывается в приёмник.
function uvProjector(matrix, sink) {
  const point = new THREE.Vector2();
  return (uv, vertex) => {
    point.fromBufferAttribute(uv, vertex).applyMatrix3(matrix);
    sink.push(point.x, point.y);
  };
}

const PART_ATTRIBUTE = "astralPart";
const PLACE_AXES = ["getX", "getY", "getZ"];
const SHEET_AXES = ["getX", "getY"];
