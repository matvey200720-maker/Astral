// Зона Z5, часть 1: описание попадания луча и работа с развёрткой сеток (острова, треугольники).
// Состояние — в общем объекте ctx (имена полей — в gun-scene-frame.js, createFrame); операции для других зон — в ctx.ops.

import { partUvTriangles } from "./gun-uv-mesh.js";
import { islandTriangles, repeatsAt, uvRepeat } from "./gun-uv.js";
import { materialName } from "./gun-scene-pure.js";
import { areaOf, partKey as keyOfPart } from "./item-mask.js";
import * as THREE from "three";

const scratch = new THREE.Vector2();

const plainVector = ({ x, y, z }) => ({ x, y, z });

// Ключ острова сетки: «uuid сетки:номер острова».
const clipKey = (uuid, island) => `${uuid}:${island}`;

export const entryNamed = (ctx, name) => ctx.entries.find((entry) => entry.name === name);

// Точка (x, y) после матрицы листа — парой [x, y].
const sheetPoint = (matrix, x, y) => {
  scratch.set(x, y).applyMatrix3(matrix);
  return [scratch.x, scratch.y];
};

// ---------------------------------------------------------------------------
// Описание попадания луча
// ---------------------------------------------------------------------------

const materialOfHit = ({ object, face }) =>
  Array.isArray(object.material) ? object.material[face?.materialIndex ?? 0] : object.material;

// Нормаль грани в осях `space` (без грани — вдоль оси z).
const surfaceNormal = (hit, space) => {
  if (!hit.face) return new THREE.Vector3(0, 0, 1);
  const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  return worldNormal.transformDirection(space.matrixWorld.clone().invert()).normalize();
};

// Точка попадания и нормаль грани, обращённая к глазу, в осях `space`.
// Вектор на глаз нормализуется только в осях держателя: на знак скалярного произведения это не влияет.
const hitInSpace = (hit, space, eye, normaliseEye) => {
  const point = space.worldToLocal(hit.point.clone());
  const toEye = space.worldToLocal(eye.clone()).sub(point);
  if (normaliseEye) toEye.normalize();
  const normal = surfaceNormal(hit, space);
  if (normal.dot(toEye) < 0) normal.negate();
  return { point: plainVector(point), normal: plainVector(normal) };
};

const describeEntryHit = (ctx, hit, entry, eye) => {
  const triangle = Number.isInteger(hit.faceIndex) ? hit.faceIndex : null;
  const islands = hit.object.userData.astralUvIslands;
  const island = islands && triangle !== null ? clipKey(hit.object.uuid, islands[triangle]) : null;
  const { x: u, y: v } = entry.mapper.transformUv(hit.uv.clone());
  const { point, normal } = hitInSpace(hit, ctx.holder, eye, true);
  const model = hitInSpace(hit, ctx.root, eye, false);
  return {
    material: entry.name,
    u,
    v,
    island,
    triangle,
    repeats: repeatsAt(entry.repeat, u, v),
    point,
    normal,
    model,
    distance: hit.distance,
  };
};

// Запись материала под попаданием; попадания без uv и служебные сетки-копии не в счёт.
const entryOfHit = (ctx, hit) => {
  if (!hit.uv || hit.object.userData.astralOverlay) return undefined;
  return entryNamed(ctx, materialName(materialOfHit(hit), 0));
};

// Первое подходящее попадание из списка (по возрастанию расстояния) или null:
// за предел дальности не заглядываем. Кожа из модели вещи (`astralSkinPart`, голова под бородой и причёской) закрывает всё за собой:
// луч, попавший в неё первой, мазка, наклейки, текста и картинки не даёт; у прочих служебных сеток (подложка тела, призрак) луч идёт дальше, как было.
const describeHit = (ctx, hits, eye, maxDistance) => {
  for (const hit of hits) {
    if (hit.distance > maxDistance) return null;
    if (hit.object.userData.astralSkinPart) return null;
    const entry = entryOfHit(ctx, hit);
    if (entry) return describeEntryHit(ctx, hit, entry, eye);
  }
  return null;
};

// ---------------------------------------------------------------------------
// Границы острова под кистью
// ---------------------------------------------------------------------------

// Обратное к clipKey: [uuid сетки, номер острова].
export const splitClipKey = (key) => {
  const colon = key.lastIndexOf(":");
  return [key.slice(0, colon), Number(key.slice(colon + 1))];
};

// Треугольники острова в долях листа записи; null, если нет сетки, номеров островов или записи.
const buildClip = (ctx, hit) => {
  const [nodeId, island] = splitClipKey(hit.island);
  const node = ctx.root.getObjectByProperty("uuid", nodeId);
  const entry = entryNamed(ctx, hit.material);
  const islands = node?.userData.astralUvIslands;
  if (!(node && islands && entry)) return null;
  const uvs = partUvTriangles([{ mesh: node, groups: null }], entry.mapper);
  return { key: hit.island, triangles: islandTriangles({ uvs, islands, island }) };
};

// Кэш проверяется первым: по уже запомненному ключу ответ отдаётся без сверки материала.
const islandClip = (ctx, hit) => {
  if (!ctx.root || !hit?.island) return null;
  const cached = ctx.clipCache.get(hit.island);
  if (cached) return cached;
  const clip = buildClip(ctx, hit);
  if (clip) ctx.clipCache.set(hit.island, clip);
  return clip;
};

// ---------------------------------------------------------------------------
// Чтение сеток
// ---------------------------------------------------------------------------

// Диапазоны треугольников сетки записи: [от, до) по группам геометрии с этим материалом.
export const triangleRanges = ({ mesh: { geometry }, groups }) => {
  const total = Math.floor((geometry.index ?? geometry.attributes.position).count / 3);
  if (!groups?.length) return [[0, total]];
  return groups.map(({ start, count }) => [Math.floor(start / 3), Math.min(total, Math.floor((start + count) / 3))]);
};

// Номер вершины для угла треугольника.
export const vertexOf = (geometry, triangle, corner) => {
  const slot = corner + 3 * triangle;
  return geometry.index ? geometry.index.getX(slot) : slot;
};

// Номера всех треугольников сетки записи, группа за группой.
export const trianglesOf = (item) => {
  const triangles = [];
  for (const [from, to] of triangleRanges(item)) {
    for (let triangle = from; triangle < to; triangle += 1) triangles.push(triangle);
  }
  return triangles;
};

// Вершины углов треугольников — по три подряд на треугольник.
export const cornersOf = (geometry, triangles) => {
  const corners = [];
  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner += 1) corners.push(vertexOf(geometry, triangle, corner));
  }
  return corners;
};

const islandTriangleList = (item, island) => {
  const islands = item.mesh.userData.astralUvIslands;
  return trianglesOf(item).filter((triangle) => island === islands[triangle]);
};

// Развёртка треугольников острова: uv в долях листа, номера треугольников, по запросу ключи вершин.
export const islandSheet = (entry, item, island, { keys = false } = {}) => {
  const { geometry } = item.mesh;
  const { position, uv } = geometry.attributes;
  if (!uv || !item.mesh.userData.astralUvIslands) return null;
  const triangles = islandTriangleList(item, island);
  if (!triangles.length) return null;

  const corners = cornersOf(geometry, triangles);
  const { matrix } = entry.mapper;
  const keyOf = (vertex) =>
    `${position.getX(vertex)},${position.getY(vertex)},${position.getZ(vertex)},${uv.getX(vertex)},${uv.getY(vertex)}`;
  return {
    uvs: corners.flatMap((vertex) => sheetPoint(matrix, uv.getX(vertex), uv.getY(vertex))),
    triangles,
    keys: keys ? corners.map(keyOf) : null,
  };
};

// ---------------------------------------------------------------------------
// Правка сеток
// ---------------------------------------------------------------------------

// У каждого треугольника свои вершины; индексы и порядок треугольников прежние.
export const unshareVertices = (item) => {
  const { geometry } = item.mesh;
  if (geometry.index) {
    const copy = geometry.toNonIndexed();
    for (const name of Object.keys(copy.attributes)) {
      geometry.setAttribute(name, copy.attributes[name]);
    }
    geometry.setIndex(null);
    copy.dispose();
  }
};

export const renumberTriangles = (ctx, item, from, to, triangles) => {
  const mesh = item?.mesh;
  const numbers = mesh?.userData.astralUvIslands;
  if (!numbers) return;
  ctx.clipCache.delete(clipKey(mesh.uuid, to));
  for (const triangle of triangles) {
    if (numbers[triangle] === from) numbers[triangle] = to;
  }
  ctx.clipCache.delete(clipKey(mesh.uuid, from));
};

// Копия uv в обычном Float32Array без нормализации (нормализованные значения разворачиваются getX/getY).
const floatCopyOfUv = (uv) => {
  const pairs = [];
  for (let vertex = 0; vertex < uv.count; vertex += 1) pairs.push(uv.getX(vertex), uv.getY(vertex));
  return new THREE.BufferAttribute(Float32Array.from(pairs), 2);
};

// uv надёжно читается и пишется только в Float32Array без нормализации.
const plainFloatUv = (geometry) => {
  const { uv } = geometry.attributes;
  if (uv.array instanceof Float32Array && !uv.normalized) return uv;
  const attribute = floatCopyOfUv(uv);
  geometry.setAttribute("uv", attribute);
  return attribute;
};

// Переносит развёртку острова: каждая вершина острова идёт через move(точка листа) → [u, v].
export const shiftIsland = (ctx, entry, meshIndex, island, move) => {
  const item = entry.meshes[meshIndex];
  const { geometry, userData, uuid } = item.mesh;
  if (!userData.astralUvIslands || !geometry.attributes.uv) return false;
  const uv = plainFloatUv(geometry);

  const vertices = new Set(cornersOf(geometry, islandTriangleList(item, island)));
  if (vertices.size === 0) return false;

  const { matrix: forward } = entry.mapper;
  const backward = forward.clone().invert();

  for (const vertex of vertices) {
    const [x, y] = sheetPoint(forward, uv.getX(vertex), uv.getY(vertex));
    const [movedX, movedY] = move(x, y);
    const [u, v] = sheetPoint(backward, movedX, movedY);
    uv.setXY(vertex, u, v);
  }
  entry.bakeGeometry?.dispose?.();
  entry.bakeGeometry = null;
  uv.needsUpdate = true;
  ctx.clipCache.delete(clipKey(uuid, island));
  return true;
};

export const afterIslandMove = (ctx, entry) => {
  const triangles = partUvTriangles(entry.meshes, entry.mapper);
  entry.repeat = uvRepeat(triangles);
  ctx.requestRender();
};

// Острова записи материала для маски «только вещь» (`item-mask.js`): `[{ key, mesh, island, area, triangles }]` — `key` «номер сетки в записи : номер острова», треугольники в долях листа
// (по шесть чисел на треугольник, как у `islandTriangles`). Записи нет или сеток с островами нет — null.
const itemParts = (ctx, name) => {
  const entry = entryNamed(ctx, name);
  if (!entry?.meshes?.length) return null;
  const parts = [];
  entry.meshes.forEach(({ mesh }, meshIndex) => {
    const numbers = mesh.userData.astralUvIslands;
    if (!numbers || !mesh.geometry?.attributes?.uv) return;
    const uvs = partUvTriangles([{ mesh, groups: null }], entry.mapper);
    for (const island of new Set(numbers)) {
      const triangles = islandTriangles({ uvs, islands: numbers, island });
      if (triangles.length) parts.push({ key: keyOfPart(meshIndex, island), mesh: meshIndex, island, area: areaOf(triangles), triangles });
    }
  });
  return parts.length ? parts : null;
};

// Часть вещи под попаданием (`hit` из `describeHit`: материал и «uuid сетки:остров»): «номер сетки в записи : остров» или null.
const itemPartKey = (ctx, hit) => {
  if (!hit?.island || !hit.material) return null;
  const [uuid, island] = splitClipKey(hit.island);
  const meshIndex = entryNamed(ctx, hit.material)?.meshes?.findIndex(({ mesh }) => mesh.uuid === uuid) ?? -1;
  return meshIndex < 0 || !Number.isInteger(island) ? null : keyOfPart(meshIndex, island);
};

export const attachIslandZone = (ctx) => {
  ctx.clipCache ??= new Map();
  return Object.assign(ctx.ops, {
    itemParts(name) {
      return itemParts(ctx, name);
    },
    itemPartKey(hit) {
      return itemPartKey(ctx, hit);
    },
    describeHit(hits, eye, maxDistance = Infinity) {
      return describeHit(ctx, hits, eye, maxDistance);
    },
    islandClip(hit) {
      return islandClip(ctx, hit);
    },
  });
};
