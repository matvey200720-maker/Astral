import {
  FINISH_WALL_SURFACES,
  decodeFinishWallsMap,
  finishWallCoords,
  finishWallMaterial,
  finishWallShown,
  finishWalls,
  finishWallsModelPoints,
} from "@modovik/climb-contract/recolor/finish-walls";
import { arenaOverlaySheet, arenaScene, arenaServerInventory } from "@modovik/climb-contract/recolor/arenas";
import { arenaObjectModel } from "@modovik/climb-contract/recolor/arena-objects";
import { arenaItemPlace } from "@modovik/climb-contract/recolor/arena-item-looks";

const SERVER = "majestic";
const DIFFUSE_ROLE = "diffuse";
const MODEL_EXTENSION = ".ydr";
const SHELL_SUFFIX = "_shell";
const CEILING_WORDS = ["celling", "ceiling"];

const PLANE_STRIDE = 4;
const MAX_INDEX16_VERTICES = 65535;
const MARKUP_WALL_STRIDE = 7;
const FACE_STRIDE = 9;
// Поля вершины, которые растут вместе с сеткой: имя → чисел на вершину.
const VERTEX_FIELDS = [
  ["positions", 3],
  ["normals", 3],
  ["uvs", 2],
  ["colours", 4],
  ["uvs1", 2],
];

const faceCountOf = (mesh) => Math.floor(mesh.indices.length / 3);

function memoized(compute) {
  const memo = new Map();
  return (key) => {
    if (!memo.has(key)) memo.set(key, compute(key));
    return memo.get(key);
  };
}

// ---------------------------------------------------------------- группы

/** Группы «вещь|поверхность»: какие сетки сцены берутся под картинку на стены. */
export function finishWallGroups({ materials, meshes }, server) {
  const groups = new Map();
  if (server !== SERVER || !meshes?.length || !materials) return groups;
  const inventory = arenaServerInventory(server);
  if (!inventory) return groups;

  const sheets = new Map();
  for (const sheet of inventory.textures ?? []) {
    const sheetKey = `${sheet.group}\n${sheet.name}`;
    if (!sheets.has(sheetKey)) sheets.set(sheetKey, sheet);
  }
  const files = new Set((inventory.files ?? []).map((name) => name.toLowerCase()));
  const wallSurfaces = new Set(FINISH_WALL_SURFACES);

  const materialFits = memoized((index) => {
    const material = materials[index];
    if (!material) return false;
    if (!wallSurfaces.has(material.group)) return false;
    if (!finishWallMaterial(material)) return false;
    const sheet = sheets.get(`${material.group}\n${material.name}`);
    if (!sheet || sheet.role !== DIFFUSE_ROLE) return false;
    return !arenaOverlaySheet(sheet);
  });

  const modelFileOf = memoized((entity) => {
    const name = arenaObjectModel(server, entity)?.name;
    if (!name) return null;
    const lowered = name.toLowerCase();
    const needed = lowered.endsWith(SHELL_SUFFIX) || CEILING_WORDS.some((word) => lowered.includes(word));
    if (!needed || !files.has(lowered + MODEL_EXTENSION)) return null;
    return name + MODEL_EXTENSION;
  });

  meshes.forEach((mesh, index) => {
    if (!materialFits(mesh.material)) return;
    if (!Number.isInteger(mesh.entity)) return;
    const model = modelFileOf(mesh.entity);
    if (model === null) return;

    const surface = materials[mesh.material].group;
    const key = `${mesh.entity}|${surface}`;
    let group = groups.get(key);
    if (!group) {
      const place = arenaItemPlace(server, mesh.entity);
      if (!place) return;
      group = { entity: mesh.entity, surface, model, place, meshes: [] };
      groups.set(key, group);
    }
    group.meshes.push(index);
  });
  return groups;
}

// ---------------------------------------------------------------- разметка

/** Адрес файла разметки: рядом со сценой, `.bin` → `.walls`. */
export function finishWallsMapUrl(scene) {
  if (!scene || !scene.url) return null;
  const { url } = scene;
  return url.endsWith(".bin") ? `${url.slice(0, -".bin".length)}.walls` : url;
}

// Обещание разметки по адресу на всё время жизни окна (неудача тоже запоминается).
const markupByUrl = new Map();

async function fetchMarkup(url, sceneHash) {
  try {
    const response = await globalThis.fetch(url);
    if (!response.ok) return null;
    const body = await response.arrayBuffer();
    if (!body) return null;
    const map = decodeFinishWallsMap(new Uint8Array(body));
    return map.scene === sceneHash ? map : null;
  } catch {
    return null;
  }
}

export function loadFinishWallsMap(scene) {
  const url = finishWallsMapUrl(scene);
  if (!url || typeof globalThis.fetch !== "function") return Promise.resolve(null);
  if (!markupByUrl.has(url)) markupByUrl.set(url, fetchMarkup(url, scene.sha256));
  return markupByUrl.get(url);
}

// ---------------------------------------------------------------- точки граней

/** Значения по углам граней сетки подряд (по три числа на угол); чего нет в наборе — NaN. */
function cornerValues(values, mesh) {
  const corners = faceCountOf(mesh) * 3;
  const table = Float64Array.from(values);
  const out = new Float64Array(corners * 3).fill(NaN);
  for (let corner = 0; corner < corners; corner += 1) {
    const from = mesh.indices[corner] * 3;
    out.set(table.subarray(from, from + 3), corner * 3);
  }
  return out;
}

const cornerPositions = (mesh) => cornerValues(mesh.positions, mesh);
const cornerNormals = (mesh) =>
  mesh.normals ? cornerValues(mesh.normals, mesh) : new Float64Array(faceCountOf(mesh) * FACE_STRIDE);

/** Точки и нормали граней выбранных сеток подряд: по девять чисел на грань. */
export function finishWallFacePoints(meshes, list) {
  const sizeOf = (id) => faceCountOf(meshes[id]) * FACE_STRIDE;
  const total = list.reduce((sum, id) => sum + sizeOf(id), 0);
  const points = new Float64Array(total);
  const normals = new Float64Array(total);
  let offset = 0;
  for (const id of list) {
    points.set(cornerPositions(meshes[id]), offset);
    normals.set(cornerNormals(meshes[id]), offset);
    offset += sizeOf(id);
  }
  return { normals, points };
}

// ---------------------------------------------------------------- деление на стены

function* chained(lists) {
  for (const list of lists) yield* list;
}

/** Стена номер `number` из таблицы разметки: [cls, min x y z, max x y z]. */
function markupWall(table, number) {
  const [cls, ...bounds] = table.slice(number * MARKUP_WALL_STRIDE, (number + 1) * MARKUP_WALL_STRIDE);
  return { cls, min: bounds.slice(0, 3), max: bounds.slice(3) };
}

/** Стены группы из файла разметки, если он подходит этой группе и её сеткам. */
function wallsFromMarkup(map, group, meshes) {
  if (!map) return null;
  const tag = `${group.entity}|${group.surface}`;
  const slot = map.groups.findIndex((entry) => `${entry.entity}|${entry.surface}` === tag);
  if (slot === -1) return null;

  const records = [];
  for (const id of group.meshes) {
    const record = map.meshes.get(id);
    if (!record || record.group !== slot) return null;
    if (record.faces.length !== faceCountOf(meshes[id])) return null;
    records.push(record);
  }

  const { count, start } = map.groups[slot];
  const walls = Array.from({ length: count }, (_, n) => markupWall(map.walls, start + n));
  const wallOf = Int32Array.from(chained(records.map((record) => record.faces)), (value) => value - 1);
  return { walls, wallOf };
}

/** Деление граней группы на стены: из разметки или по точкам сцены в осях модели. */
function splitGroup(meshes, group, map, modelPoints, normals) {
  const fromMarkup = wallsFromMarkup(map, group, meshes);
  if (fromMarkup) return fromMarkup;
  return finishWalls(modelPoints, finishWallsModelPoints(normals, group.place, { normals: true }));
}

/** Стена для каждой грани группы (−1 — нет стены или она уже порога), сами стены и точки углов. */
function planGroup(meshes, group, map) {
  const { points, normals } = finishWallFacePoints(meshes, group.meshes);
  const modelPoints = finishWallsModelPoints(points, group.place);
  const { walls, wallOf } = splitGroup(meshes, group, map, modelPoints, normals);

  const shown = walls.map((wall) => Boolean(wall) && finishWallShown(wall));
  const faceWall = Int32Array.from(wallOf, (wall) => (wall >= 0 && shown[wall] ? wall : -1));
  // Точка угла (номер угла сквозной по грани группы) в осях модели.
  const cornerPoint = (corner) => Array.from(modelPoints.subarray(corner * 3, corner * 3 + 3));
  return { walls, faceWall, cornerPoint };
}

// ---------------------------------------------------------------- метры и раздвоение вершин

/**
 * Раздаёт вершинам метры по их стенам. Вершина достаётся первой стене, которая её
 * взяла; вторая и следующие получают свою копию в хвосте сетки (одну на пару
 * «вершина, стена»).
 */
class VertexForks {
  constructor(vertexCount, measure) {
    this.vertexCount = vertexCount;
    this.measure = measure;
    this.owner = new Int32Array(vertexCount).fill(-1);
    this.meters = [];
    this.forks = [];
    this.forkAt = new Map();
  }

  /** Индекс вершины, которым угол грани встаёт на стену `wall`; `corner` — сквозной номер угла в группе. */
  place(vertex, wall, corner) {
    const owner = this.owner[vertex];
    if (owner === wall) return vertex;
    if (owner === -1) {
      this.owner[vertex] = wall;
      this.meters[vertex] = this.measure(corner, wall);
      return vertex;
    }
    const tag = wall * this.vertexCount + vertex;
    let fork = this.forkAt.get(tag);
    if (fork === undefined) {
      fork = this.vertexCount + this.forks.length;
      this.forkAt.set(tag, fork);
      this.forks.push({ from: vertex, meters: this.measure(corner, wall) });
    }
    return fork;
  }

  get total() {
    return this.vertexCount + this.forks.length;
  }

  planes() {
    const planes = new Float32Array(this.total * PLANE_STRIDE);
    this.meters.forEach((meters, vertex) => planes.set(meters, vertex * PLANE_STRIDE));
    this.forks.forEach((fork, n) => planes.set(fork.meters, (this.vertexCount + n) * PLANE_STRIDE));
    return planes;
  }

  /** Поля вершины сетки, выросшие на копии (только типизированные массивы). */
  grownFields(mesh) {
    const grown = {};
    if (this.forks.length === 0) return grown;
    for (const [name, width] of VERTEX_FIELDS) {
      const field = mesh[name];
      if (!ArrayBuffer.isView(field)) continue;
      const wider = new field.constructor(field.length + this.forks.length * width);
      wider.set(field);
      this.forks.forEach((fork, n) => {
        wider.set(field.subarray(fork.from * width, (fork.from + 1) * width), field.length + n * width);
      });
      grown[name] = wider;
    }
    return grown;
  }
}

/** Номера углов граней сетки подряд: 0, 1, 2 — первая грань, 3, 4, 5 — вторая и так далее. */
function* cornerSlots(faceCount) {
  for (let slot = 0; slot < faceCount * 3; slot += 1) yield slot;
}

function meshWithPlanes(mesh, firstFace, plan) {
  const { cornerPoint, faceWall, walls } = plan;
  const forks = new VertexForks(Math.floor(mesh.positions.length / 3), (corner, wall) =>
    finishWallCoords(cornerPoint(corner), walls[wall].cls, walls[wall]),
  );

  const indices = Uint32Array.from(mesh.indices);
  for (const slot of cornerSlots(faceCountOf(mesh))) {
    const wall = faceWall[firstFace + Math.floor(slot / 3)];
    if (wall >= 0) indices[slot] = forks.place(indices[slot], wall, firstFace * 3 + slot);
  }

  const fitsIn16 = forks.total <= MAX_INDEX16_VERTICES && mesh.indices instanceof Uint16Array;
  return {
    ...mesh,
    ...forks.grownFields(mesh),
    indices: fitsIn16 ? Uint16Array.from(indices) : indices,
    planes: forks.planes(),
  };
}

/** Сцена, у сеток поверхностей которой есть `planes`: [s, t, ширина, высота] в метрах. */
export function withFinishPlanes(asset, server, map = null) {
  const groups = finishWallGroups(asset || {}, server);
  if (groups.size === 0) return asset;

  const meshes = asset.meshes.slice();
  for (const group of groups.values()) {
    const plan = planGroup(asset.meshes, group, map);
    let firstFace = 0;
    for (const id of group.meshes) {
      meshes[id] = meshWithPlanes(asset.meshes[id], firstFace, plan);
      firstFace += faceCountOf(asset.meshes[id]);
    }
  }
  return { ...asset, meshes };
}

/** Готовит сцену зала для кадра: разметка стен с сервера, а без неё — деление по точкам сцены. */
export async function prepareFinishWalls(asset, server) {
  if (server !== SERVER) return asset;
  const map = await loadFinishWallsMap(arenaScene(server, "inside"));
  return withFinishPlanes(asset, server, map);
}
