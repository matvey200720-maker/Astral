/*
 * Луч по дереву коробок вместо перебора всех треугольников (ТЗ 26.10.2026, перф щелчка и наведения; см. `triangle-bvh.js`).
 *
 * Сетка, у которой есть дерево, получает свой `raycast`: тот же ответ, что у штатного `THREE.Mesh.raycast` (`distance`, `point`, `object`,
 * `face`, `faceIndex`, `uv`, `normal`, `barycoord` — по тем же формулам, с тем же учётом стороны материала), но проверяются только треугольники
 * листьев, которых коснулся луч. Сетка без дерева, с несколькими материалами, с урезанным `drawRange` или с чередующимися атрибутами идёт
 * штатным путём — дерево лишь ускорение, ответ не меняет (тест сверяет оба пути на настоящей сцене).
 *
 * Деревья строит поток (`ray-accel-worker.js`) после того, как кадр сцены уже показан: сперва самые тяжёлые сетки, порциями, чтобы копия
 * вершин для потока не занимала окно разом. Пока дерева нет, луч идёт штатно — ответ тот же, просто дольше.
 */

import * as THREE from "three";
import { MIN_ACCEL_TRIANGLES, bvhFits, walkTriangleBvh } from "./triangle-bvh.js";
import { worldBoxOf } from "./pick-surface.js";

const inverse = new THREE.Matrix4();
const IDENTITY = new THREE.Matrix4();
const localRay = new THREE.Ray();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const point = new THREE.Vector3();
const world = new THREE.Vector3();

/* Состояние одного вызова — переменные модуля, а не замыкание и не разбор объекта на каждый треугольник: за обход их проходят тысячи. */
let cIndex = null;
let cPosition = null;
let cCulling = false;
let cFlip = false;
let cRaycaster = null;
let cMesh = null;
let cHits = null;
let cUv = null;
let cNormal = null;
let originX = 0;
let originY = 0;
let originZ = 0;
let dirX = 0;
let dirY = 0;
let dirZ = 0;

function visit(triangle) {
  const index = cIndex;
  const position = cPosition;
  const raycaster = cRaycaster;
  const mesh = cMesh;
  const base = triangle * 3;
  const a = index[base];
  const b = index[base + 1];
  const c = index[base + 2];
  const ia = a * 3;
  const ib = b * 3;
  const ic = c * 3;
  /* Порядок вершин — как у `checkIntersection`: у `BackSide` обход обратный. */
  const p = cFlip ? ic : ia;
  const q = ib;
  const r = cFlip ? ia : ic;
  const ax = position[p];
  const ay = position[p + 1];
  const az = position[p + 2];
  const e1x = position[q] - ax;
  const e1y = position[q + 1] - ay;
  const e1z = position[q + 2] - az;
  const e2x = position[r] - ax;
  const e2y = position[r + 1] - ay;
  const e2z = position[r + 2] - az;
  /* `Ray.intersectTriangle` three.js, слово в слово, без объектов. */
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  let ddn = dirX * nx + dirY * ny + dirZ * nz;
  let sign;
  if (ddn > 0) {
    if (cCulling) return;
    sign = 1;
  } else if (ddn < 0) {
    sign = -1;
    ddn = -ddn;
  } else {
    return;
  }
  const dx = originX - ax;
  const dy = originY - ay;
  const dz = originZ - az;
  /* diff × edge2 */
  const cx = dy * e2z - dz * e2y;
  const cy = dz * e2x - dx * e2z;
  const cz = dx * e2y - dy * e2x;
  const ddqxe2 = sign * (dirX * cx + dirY * cy + dirZ * cz);
  if (ddqxe2 < 0) return;
  /* edge1 × diff */
  const kx = e1y * dz - e1z * dy;
  const ky = e1z * dx - e1x * dz;
  const kz = e1x * dy - e1y * dx;
  const dde1xq = sign * (dirX * kx + dirY * ky + dirZ * kz);
  if (dde1xq < 0) return;
  if (ddqxe2 + dde1xq > ddn) return;
  const qdn = -sign * (dx * nx + dy * ny + dz * nz);
  if (qdn < 0) return;
  const along = qdn / ddn;
  point.set(originX + dirX * along, originY + dirY * along, originZ + dirZ * along);
  world.copy(point).applyMatrix4(mesh.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(world);
  if (distance < raycaster.near || distance > raycaster.far) return;

  const hit = { distance, point: world.clone(), object: mesh };
  vA.fromArray(position, ia);
  vB.fromArray(position, ib);
  vC.fromArray(position, ic);
  const barycoord = new THREE.Vector3();
  THREE.Triangle.getBarycoord(point, vA, vB, vC, barycoord);
  if (cUv) hit.uv = THREE.Triangle.getInterpolatedAttribute(cUv, a, b, c, barycoord, new THREE.Vector2());
  if (cNormal) {
    hit.normal = THREE.Triangle.getInterpolatedAttribute(cNormal, a, b, c, barycoord, new THREE.Vector3());
    if (hit.normal.dot(localRay.direction) > 0) hit.normal.multiplyScalar(-1);
  }
  const faceNormal = new THREE.Vector3();
  THREE.Triangle.getNormal(vA, vB, vC, faceNormal);
  hit.face = { a, b, c, normal: faceNormal, materialIndex: 0 };
  hit.barycoord = barycoord;
  hit.faceIndex = triangle;
  cHits.push(hit);
}

/**
 * Луч по сетке через её дерево: то же, что `THREE.Mesh.prototype.raycast`, но по листьям, которых коснулся луч.
 *
 * @param {THREE.Mesh} mesh
 * @param {object} bvh — `buildTriangleBvh`
 * @param {THREE.Raycaster} raycaster
 * @param {THREE.Intersection[]} intersects
 */
export function accelRaycast(mesh, bvh, raycaster, intersects) {
  const material = mesh.material;
  if (material === undefined) return;
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  const { start, count } = geometry.drawRange;
  if (Array.isArray(material) || !index || !position || position.isInterleavedBufferAttribute || start !== 0 || count !== Infinity || !bvhFits(bvh, index.array)) {
    THREE.Mesh.prototype.raycast.call(mesh, raycaster, intersects);
    return;
  }
  mesh.updateWorldMatrix(true, false);
  inverse.copy(mesh.matrixWorld).invert();
  localRay.copy(raycaster.ray).applyMatrix4(inverse);
  const side = material.side;
  const uv = geometry.attributes.uv;
  const normal = geometry.attributes.normal;
  cIndex = index.array;
  cPosition = position.array;
  cCulling = side === THREE.BackSide || side === THREE.FrontSide;
  cFlip = side === THREE.BackSide;
  cRaycaster = raycaster;
  cMesh = mesh;
  cHits = intersects;
  cUv = uv && !uv.isInterleavedBufferAttribute ? uv : null;
  cNormal = normal && !normal.isInterleavedBufferAttribute ? normal : null;
  originX = localRay.origin.x;
  originY = localRay.origin.y;
  originZ = localRay.origin.z;
  dirX = localRay.direction.x;
  dirY = localRay.direction.y;
  dirZ = localRay.direction.z;
  /* Сетки сцены неподвижны и стоят в мировых осях: расстояние по лучу — то же, что в мире, и дальше `far` смотреть незачем. */
  const reach = mesh.matrixWorld.equals(IDENTITY) ? raycaster.far : Infinity;
  try {
    walkTriangleBvh(bvh, originX, originY, originZ, dirX, dirY, dirZ, reach, visit);
  } finally {
    cIndex = null;
    cPosition = null;
    cRaycaster = null;
    cMesh = null;
    cHits = null;
    cUv = null;
    cNormal = null;
  }
}

/** Сетке — своё дерево: её `raycast` идёт по нему. Дерево не сошлось с сеткой (другое число треугольников) — сетка остаётся штатной. */
export function attachRayAccel(mesh, bvh) {
  const index = mesh.geometry?.index;
  if (!bvh || !index || !bvhFits(bvh, index.array)) return false;
  mesh.userData.accel = bvh;
  mesh.raycast = function raycastWithTree(raycaster, intersects) {
    accelRaycast(this, bvh, raycaster, intersects);
  };
  return true;
}

/* Сколько треугольников уходит потоку одним сообщением: копия вершин — не больше пары миллисекунд окна на порцию. */
const CHUNK_TRIANGLES = 120_000;

let worker = null;
let nextId = 1;
const waiting = new Map();

function workerOf() {
  if (worker || typeof Worker === "undefined") return worker;
  try {
    const made = new Worker(new URL("./ray-accel-worker.js", import.meta.url), { type: "module" });
    made.onmessage = (event) => {
      const { id, trees, error } = event.data;
      const entry = waiting.get(id);
      waiting.delete(id);
      if (!entry) return;
      if (error) entry.reject(new Error(error));
      else entry.resolve(trees);
    };
    made.onerror = () => {
      for (const entry of waiting.values()) entry.reject(new Error("поток деревьев луча не ответил"));
      waiting.clear();
      worker = null;
    };
    worker = made;
  } catch {
    worker = null;
  }
  return worker;
}

const idle = (callback) => (typeof requestIdleCallback === "function" ? requestIdleCallback(callback, { timeout: 2500 }) : setTimeout(callback, 250));

/**
 * Деревья для сеток сцены — в потоке, порциями, самые тяжёлые первыми; готовое сразу садится на свою сетку.
 *
 * @param {Array<{ positions: Float32Array, indices: Uint16Array|Uint32Array }>} assetMeshes — сетки разобранной сцены
 * @param {THREE.Mesh[]} logical — логические сетки в том же порядке
 * @returns {{ cancel: () => void }} `cancel` — кадр ушёл, незавершённое бросается
 */
export function startRayAccel(assetMeshes, logical) {
  const state = { cancelled: false };
  const handle = { cancel: () => (state.cancelled = true) };
  if (typeof Worker === "undefined") return handle;
  const wanted = [];
  /* Копии моделей (сцена версии 3) делят геометрию: дерево строится по модели один раз, а лучу сетки-копии луч приводится в её местные оси (`accelRaycast`). */
  const byModel = new Map();
  for (let at = 0; at < assetMeshes.length; at += 1) {
    const triangles = Math.floor(assetMeshes[at].indices.length / 3);
    if (triangles < MIN_ACCEL_TRIANGLES) continue;
    const model = assetMeshes[at].instance?.model;
    if (model) {
      const item = byModel.get(model);
      if (item) item.ats.push(at);
      else {
        const made = { at, ats: [at], triangles, source: model };
        byModel.set(model, made);
        wanted.push(made);
      }
    } else wanted.push({ at, ats: [at], triangles, source: assetMeshes[at] });
  }
  wanted.sort((left, right) => right.triangles - left.triangles);
  const chunks = [];
  let chunk = [];
  let total = 0;
  for (const item of wanted) {
    if (chunk.length && total + item.triangles > CHUNK_TRIANGLES) {
      chunks.push(chunk);
      chunk = [];
      total = 0;
    }
    chunk.push(item);
    total += item.triangles;
  }
  if (chunk.length) chunks.push(chunk);

  /* Коробки сеток в мире (`pickSurface`) считаются при первом луче — сотни сеток на холодном коде: первый щелчок после открытия сцены платил за это сам. Считаем в простое. */
  idle(() => {
    if (!state.cancelled) for (const mesh of logical) worldBoxOf(mesh);
  });

  const next = (number) => {
    if (state.cancelled || number >= chunks.length) return;
    idle(() => {
      if (state.cancelled) return;
      const target = workerOf();
      if (!target) return;
      const items = chunks[number];
      const id = nextId;
      nextId += 1;
      new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        target.postMessage({ id, meshes: items.map(({ source }) => ({ positions: source.positions, indices: source.indices })) });
      })
        .then((trees) => {
          if (state.cancelled) return;
          items.forEach(({ ats }, order) => {
            /* Дерево — и записи сцены: перелёт камеры считает лучи по ней, без three (`items-focus.js`). Копии одной модели берут одно дерево. */
            for (const at of ats) if (trees[order] && logical[at] && attachRayAccel(logical[at], trees[order]) && !assetMeshes[at].instance) assetMeshes[at].rayTree = trees[order];
          });
          next(number + 1);
        })
        .catch(() => {
          /* Поток не ответил — лучи идут штатно, ответ тот же. */
        });
    });
  };
  next(0);
  return handle;
}
