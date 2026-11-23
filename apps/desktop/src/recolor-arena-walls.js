import zlib from "node:zlib";
import { readDrawable as parseDrawable } from "@modovik/rage-drawable";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import * as finish from "@modovik/climb-contract/recolor/finish-walls";
import { deflateRaw } from "@modovik/native-rs";
import { majesticSurfaceOf } from "./recolor-arena-surfaces.js";
import { PART_VERTEX_LIMIT } from "./recolor-arena-parts.js";
import { inflateRaw } from "./recolor-sheets.js";

const MODEL_EXTENSION = /\.ydr$/i;
const CEILING_NAME = /ce(?:ll|il)ing/;
// Ресурс крупнее этого сжимается быстрее и слабее.
const FAST_DEFLATE_ABOVE = 8 * 1024 * 1024;
const FAST_DEFLATE_LEVEL = 6;
const AXES = [0, 1, 2];

function asBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

// Векторная арифметика над тройками чисел; порядок слагаемых в формулах не менять.
function minus(to, from) {
  return [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
}

// Минор пары осей: u[j]·v[k] − u[k]·v[j].
function minor(u, v, j, k) {
  return u[j] * v[k] - u[k] * v[j];
}

// Векторное произведение: компоненты идут по парам осей (1, 2), (2, 0), (0, 1).
function crossOf(u, v) {
  return [minor(u, v, 1, 2), minor(u, v, 2, 0), minor(u, v, 0, 1)];
}

function lengthOrOne(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]) || 1;
}

// Ось «Y вверх» модели -> ось «Z вверх» игры: (x, y, z) -> (x, -z, y), читая сырые значения.
function gameVector(list, index) {
  const at = index * 3;
  const [x, y, z] = [list[at], list[at + 1], list[at + 2]];
  return [x, -z, y];
}

export function isFinishWallModel(name) {
  const stem = String(name || "").toLowerCase().replace(MODEL_EXTENSION, "");
  return stem.endsWith("_shell") || CEILING_NAME.test(stem);
}

export function faceSurface(model, points) {
  const normal = crossOf(minus(points[1], points[0]), minus(points[2], points[0]));
  const modelName = String(model).replace(MODEL_EXTENSION, "");
  return majesticSurfaceOf(modelName, normal[2] / lengthOrOne(normal));
}

// Учёт мешей: пропускает те, чей номер индексов уже встречался, и ведёт сквозной счётчик вершин (base).
function createMeshLedger() {
  const seenAt = new Set();
  let vertexBase = 0;
  return (mesh) => {
    if (!Number.isInteger(mesh.indicesAt) || seenAt.has(mesh.indicesAt)) return null;
    seenAt.add(mesh.indicesAt);
    const base = vertexBase;
    vertexBase += mesh.positions.length / 3;
    return { mesh, base };
  };
}

// Меши с целым номером индексов, ещё не встречавшиеся, вместе с числом вершин в мешах до них.
function* freshMeshes(readDrawable) {
  const admit = createMeshLedger();
  for (const drawable of readDrawable.drawables) {
    for (const mesh of drawable.meshes) {
      const fresh = admit(mesh);
      if (fresh) yield fresh;
    }
  }
}

// Тройки индексов меша по порядку; тройка из одного индекса — уже вырезанная грань, её пропускаем.
function* liveTriples(indices) {
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const corner = AXES.map((shift) => indices[at + shift]);
    if (!corner.every((index) => index === corner[0])) yield { at, corner };
  }
}

// Плоский обход всех граней-кандидатов: (меш, тройка индексов). Вершины считаются сквозным счётчиком.
function* walkTriangles(readDrawable) {
  for (const { mesh, base } of freshMeshes(readDrawable)) {
    const { material } = mesh;
    const sheet = String(material?.textures?.diffuse || "").toLowerCase();
    if (sheet && finish.finishWallShader(material?.shader)) {
      for (const { at, corner } of liveTriples(mesh.indices)) {
        yield { mesh, base, sheet, at, corner };
      }
    }
  }
}

// Поля записи поверхности в порядке заведения.
const SHELF_FIELDS = ["points", "normals", "ids", "refs"];

const newShelf = () => Object.fromEntries(SHELF_FIELDS.map((field) => [field, []]));

// Накопитель: складывает принятую грань в запись своей поверхности (запись заводится при первой грани).
function shelve(book, surface, { mesh, base, at, corner }, triangle) {
  if (!book.has(surface)) book.set(surface, newShelf());
  const shelf = book.get(surface);
  const normalOf = mesh.normals ? (index) => gameVector(mesh.normals, index) : () => [0, 0, 0];
  const additions = {
    refs: [[mesh.indicesAt, at]],
    points: triangle.flat(),
    normals: corner.flatMap(normalOf),
    ids: corner.map((index) => base + index),
  };
  for (const field of SHELF_FIELDS) shelf[field].push(...additions[field]);
}

export function surfaceFaces(bytes, model, sheets) {
  const resource = openResourceWith(asBytes(bytes), inflateRaw);
  const readDrawable = parseDrawable(resource, { inflateRaw, lod: "high" });
  const book = new Map();
  for (const found of walkTriangles(readDrawable)) {
    const triangle = Array.from(found.corner, (index) => gameVector(found.mesh.positions, index));
    const surface = faceSurface(model, triangle);
    if (surface && sheets.get(surface)?.has(found.sheet)) shelve(book, surface, found, triangle);
  }
  return book;
}

// Грани стен, берущих картинку: по возрастанию номера стены, внутри — по возрастанию номера грани.
// Проверка «берёт картинку» делается для всех граней до первой выдачи.
function* facesInWallOrder(walls, wallOf) {
  const facesByWall = new Map();
  wallOf.forEach((wallNo, face) => {
    if (wallNo >= 0 && finish.finishWallShown(walls[wallNo])) {
      if (!facesByWall.has(wallNo)) facesByWall.set(wallNo, []);
      facesByWall.get(wallNo).push(face);
    }
  });
  for (const wallNo of [...facesByWall.keys()].sort((a, b) => a - b)) {
    for (const face of facesByWall.get(wallNo)) yield { wallNo, wall: walls[wallNo], face };
  }
}

function unitFaceNormal(corners) {
  const cross = crossOf(minus(corners[1], corners[0]), minus(corners[2], corners[0]));
  const length = lengthOrOne(cross);
  return [cross[0] / length, cross[1] / length, cross[2] / length];
}

// Три числа грани, начиная с угла `corner`, из плоского списка (по девять чисел на грань).
function cornerTriple(list, face, corner) {
  const from = face * 9 + corner * 3;
  return [list[from], list[from + 1], list[from + 2]];
}

// Положение, нормаль и развёртка одного угла грани; нулевая записанная нормаль заменяется нормалью грани.
function describeVertex(faces, face, corner, corners, wall, metres, aspect) {
  const written = cornerTriple(faces.normals, face, corner);
  const position = corners[corner];
  const coords = finish.finishWallCoords(position, wall.cls, wall);
  const uv = finish.finishWallUv(coords, metres, aspect);
  const blank = written.every((value) => value === 0);
  return { position, normal: blank ? unitFaceNormal(corners) : written, uv };
}

function emptyPiece() {
  return { vertices: new Map(), indices: [] };
}

function sealPiece({ vertices, indices }) {
  const list = [...vertices.values()];
  const gather = (field) => Float32Array.from(list.flatMap((vertex) => vertex[field]));
  // Крайнее значение по каждой оси: pick — Math.min или Math.max, seed — с чего начинать.
  const extreme = (pick, seed) => AXES.map((axis) => {
    let best = seed;
    for (const vertex of list) best = pick(best, vertex.position[axis]);
    return best;
  });
  return {
    positions: gather("position"),
    normals: gather("normal"),
    uvs: gather("uv"),
    indices: Uint32Array.from(indices),
    bounds: { min: extreme(Math.min, Infinity), max: extreme(Math.max, -Infinity) },
  };
}

export function projectedSurfaceMeshes(faces, metres = 0, aspect = 1) {
  const points = Float64Array.from(faces.points);
  const normals = Float64Array.from(faces.normals);
  const { walls, wallOf } = finish.finishWalls(points, normals);
  const meshes = [];
  const kept = [];
  const usedWalls = new Set();
  let piece = emptyPiece();
  const flush = () => {
    if (piece.indices.length) meshes.push(sealPiece(piece));
  };
  for (const { wallNo, wall, face } of facesInWallOrder(walls, wallOf)) {
    usedWalls.add(wallNo);
    kept.push(face);
    const keys = AXES.map((corner) => `${wallNo}:${faces.ids[face * 3 + corner]}`);
    const unseen = keys.reduce((count, key) => count + (piece.vertices.has(key) ? 0 : 1), 0);
    if (piece.vertices.size + unseen > PART_VERTEX_LIMIT) {
      flush();
      piece = emptyPiece();
    }
    const corners = Array.from(keys, (key, corner) => cornerTriple(faces.points, face, corner));
    keys.forEach((key, corner) => {
      if (!piece.vertices.has(key)) {
        const vertex = describeVertex(faces, face, corner, corners, wall, metres, aspect);
        piece.vertices.set(key, Object.assign({ slot: piece.vertices.size }, vertex));
      }
      piece.indices.push(piece.vertices.get(key).slot);
    });
  }
  flush();
  return { meshes, walls: usedWalls.size, faces: kept };
}

// Адрес индекса грани в данных ресурса: по два байта на индекс, от начала индексов меша.
const indexAddress = (start, slot) => start + slot * 2;

// Все три индекса грани становятся равны первому: грань сводится в точку.
function collapseRef(view, [start, at]) {
  const first = view.getUint16(indexAddress(start, at), true);
  [1, 2].forEach((shift) => view.setUint16(indexAddress(start, at + shift), first, true));
}

// Ресурс с обвалившимися гранями: данные пережимаются, заголовок берётся из буфера под видом.
function repackCollapsed(source, refs) {
  const resource = openResourceWith(source, inflateRaw);
  const { data } = resource;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  refs.forEach((ref) => collapseRef(view, ref));
  const level = data.length > FAST_DEFLATE_ABOVE ? FAST_DEFLATE_LEVEL : zlib.constants.Z_BEST_COMPRESSION;
  const compressed = deflateRaw(data, { level });
  const header = Buffer.from(source.buffer, source.byteOffset, RSC7_HEADER_BYTES);
  const packed = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  let offset = 0;
  for (const part of [header, compressed]) {
    part.copy(packed, offset);
    offset += part.length;
  }
  return packed;
}

export function collapseFaces(bytes, refs) {
  const source = asBytes(bytes);
  return refs.length ? repackCollapsed(source, refs) : Buffer.from(source);
}
