import * as THREE from "three";

/*
 * Предмет сцены без номеров сущностей — остров сетки (ТЗ 26.10.2026, п. B: «выделяю эти перила — они выделяются, вот эти нет»).
 *
 * У сцен версии 2 (арена, интерьеры) предмет называет номер сущности. У завода, ангара и мест карты номеров нет: сетка
 * сцены — «все стены одним материалом в этом углу», 1160 и больше треугольников, и подсветка сетки целиком светила
 * ползавода (проверка на настоящей сцене 26.10: щелчок по стене башни обвёл стены трёх зданий и галереи). Предмет в такой сцене
 * — связный кусок поверхности: треугольники, что делят вершины (склеенные до `WELD` метра), — одна башня, одна секция забора,
 * одни перила. Остров под щелчком называет номер треугольника попадания (`hit.faceIndex`), а подсветка берёт его кусок
 * сетки — свою маленькую геометрию без общих буферов с большой (освобождается она отдельно и чужую не трогает).
 *
 * Остров считается один раз на сетку (метки треугольников по склеенным вершинам, `WeakMap` на геометрию), кусок — один раз
 * на остров (не больше `PROXY_LIMIT`, вытесняются давние). На сценах завода и ангара: 276 и 72 сетки, 3771 и 1764 острова,
 * самый большой — 908 треугольников, медиана — 10; расчёт всех островов вместе — 50 и 19 мс.
 */

/* Склейка вершин: обратная величина шага, 1/WELD метра — вершины стыка соседних частей сходятся до него. */
const WELD = 500;
/* Кусков-островов в памяти не больше стольких: наведение перебирает их без числа, а каждый — своя маленькая геометрия. */
const PROXY_LIMIT = 48;

const labelCache = new WeakMap();
/* Куски подсветки: `Map(ключ → кусок)` в порядке последнего обращения, ключ — сетка и номер острова. */
const proxies = new Map();
const meshIds = new WeakMap();
let meshCounter = 0;

/** Номера островов у треугольников геометрии: `{ labels: Int32Array, sizes: Int32Array, count }` или `null` — геометрия без индекса или позиций. */
export function islandLabels(geometry) {
  if (!geometry) return null;
  if (labelCache.has(geometry)) return labelCache.get(geometry);
  const position = geometry.attributes?.position;
  const index = geometry.index;
  let result = null;
  if (position && index && index.count >= 3) {
    const vertices = position.count;
    const welded = new Map();
    const vertexNode = new Int32Array(vertices);
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      const key = `${Math.round(position.getX(vertex) * WELD)},${Math.round(position.getY(vertex) * WELD)},${Math.round(position.getZ(vertex) * WELD)}`;
      let node = welded.get(key);
      if (node === undefined) {
        node = welded.size;
        welded.set(key, node);
      }
      vertexNode[vertex] = node;
    }
    const parent = new Int32Array(welded.size);
    for (let node = 0; node < parent.length; node += 1) parent[node] = node;
    const find = (start) => {
      let node = start;
      while (parent[node] !== node) {
        parent[node] = parent[parent[node]];
        node = parent[node];
      }
      return node;
    };
    const triangles = Math.floor(index.count / 3);
    for (let triangle = 0; triangle < triangles; triangle += 1) {
      const first = find(vertexNode[index.getX(triangle * 3)]);
      for (let corner = 1; corner < 3; corner += 1) {
        const other = find(vertexNode[index.getX(triangle * 3 + corner)]);
        if (other !== first) parent[other] = first;
      }
    }
    const numbers = new Map();
    const labels = new Int32Array(triangles);
    for (let triangle = 0; triangle < triangles; triangle += 1) {
      const root = find(vertexNode[index.getX(triangle * 3)]);
      let number = numbers.get(root);
      if (number === undefined) {
        number = numbers.size;
        numbers.set(root, number);
      }
      labels[triangle] = number;
    }
    const sizes = new Int32Array(numbers.size);
    for (let triangle = 0; triangle < triangles; triangle += 1) sizes[labels[triangle]] += 1;
    result = { labels, sizes, count: numbers.size };
  }
  labelCache.set(geometry, result);
  return result;
}

/** Остров под треугольником `face` сетки: `{ label, size, total }` — сколько в нём треугольников и сколько всего у сетки; `null` — острова не назвать. */
export function islandOf(mesh, face) {
  if (!Number.isInteger(face) || face < 0) return null;
  const found = islandLabels(mesh?.geometry);
  if (!found || face >= found.labels.length) return null;
  const label = found.labels[face];
  return { label, size: found.sizes[label], total: found.labels.length };
}

/** Кусок подсветки — остров `label` сетки `mesh`: независимая геометрия (свои вершины и индекс) в осях сетки, в формате `proxies` подсветки. */
export function islandProxy(mesh, label) {
  const found = islandLabels(mesh.geometry);
  if (!found) return null;
  if (!meshIds.has(mesh)) meshIds.set(mesh, (meshCounter += 1));
  const key = `${meshIds.get(mesh)}:${label}`;
  const known = proxies.get(key);
  if (known) {
    proxies.delete(key);
    proxies.set(key, known);
    return known;
  }
  const source = mesh.geometry;
  const position = source.attributes.position;
  const uv = source.attributes.uv;
  const index = source.index;
  const used = new Map();
  const corners = [];
  for (let triangle = 0; triangle < found.labels.length; triangle += 1) {
    if (found.labels[triangle] !== label) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = index.getX(triangle * 3 + corner);
      if (!used.has(vertex)) used.set(vertex, used.size);
      corners.push(used.get(vertex));
    }
  }
  const positions = new Float32Array(used.size * 3);
  const coords = new Float32Array(used.size * 2);
  for (const [vertex, at] of used) {
    positions[at * 3] = position.getX(vertex);
    positions[at * 3 + 1] = position.getY(vertex);
    positions[at * 3 + 2] = position.getZ(vertex);
    if (uv) {
      coords[at * 2] = uv.getX(vertex);
      coords[at * 2 + 1] = uv.getY(vertex);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(coords, 2));
  geometry.setIndex(new THREE.BufferAttribute(used.size > 65535 ? new Uint32Array(corners) : new Uint16Array(corners), 1));
  const proxy = {
    geometry,
    /* Тот же мировой вид, что у сетки: остров лежит там, где она (сетка может ехать). */
    get matrixWorld() {
      return mesh.matrixWorld;
    },
    updateWorldMatrix(parents, children) {
      mesh.updateWorldMatrix?.(parents, children);
    },
    userData: {},
    visible: true,
    isProxy: true,
    isIsland: true,
    dispose: () => geometry.dispose(),
  };
  proxies.set(key, proxy);
  let islands = 0;
  for (const item of proxies.values()) if (item.isIsland) islands += 1;
  for (const [oldKey, old] of proxies) {
    if (islands <= PROXY_LIMIT) break;
    if (!old.isIsland) continue;
    proxies.delete(oldKey);
    old.dispose();
    islands -= 1;
  }
  return proxy;
}

/* Куски по диапазонам разметки: ключ — состав цели (элементы разметки); держатся недолго и мало — каждый свой, большой, в мировых осях. */
const RANGE_LIMIT = 12;

const signatures = new WeakMap();

/** Короткий ключ набора диапазонов (FNV-1a по числам): один и тот же набор — один ключ; считается один раз на массив. */
export function runsSignature(runs) {
  let known = signatures.get(runs);
  if (known) return known;
  let hash = 2166136261;
  for (let at = 0; at < runs.length; at += 1) hash = Math.imul(hash ^ runs[at], 16777619) >>> 0;
  known = `${runs.length / 3}:${hash.toString(36)}`;
  signatures.set(runs, known);
  return known;
}

/**
 * Кусок подсветки — треугольники по диапазонам разметки выделения (`.selmap`): `runs` — тройки `mesh, from, end` (номер сетки в
 * `asset.meshes` — `userData.meshIndex`; номера треугольников `[from, end)` — по индексу геометрии сетки сцены). Одна геометрия на
 * все сетки цели, в мировых осях (вершины общие у соседних треугольников одной сетки): «все планшеты» — один кусок, а не по куску на
 * сетку, и вытеснение давних не освобождает то, что ещё на кадре. `key` — состав цели (одинаковый у того же набора диапазонов).
 * Сеток цели в `meshes` нет (сцена ещё грузится, или чужая) — `null`.
 */
export function rangeProxy(meshes, runs, key) {
  const cacheKey = `runs:${key}`;
  const known = proxies.get(cacheKey);
  if (known) {
    proxies.delete(cacheKey);
    proxies.set(cacheKey, known);
    return known;
  }
  const byIndex = new Map();
  for (const mesh of meshes) if (Number.isInteger(mesh.userData?.meshIndex)) byIndex.set(mesh.userData.meshIndex, mesh);
  const positions = [];
  const corners = [];
  const point = new THREE.Vector3();
  for (let at = 0; at + 2 < runs.length; at += 3) {
    const mesh = byIndex.get(runs[at]);
    const index = mesh?.geometry?.index;
    const position = mesh?.geometry?.attributes?.position;
    if (!index || !position) continue;
    mesh.updateWorldMatrix?.(true, false);
    const triangles = Math.floor(index.count / 3);
    const used = new Map();
    for (let triangle = Math.max(0, runs[at + 1]); triangle < Math.min(runs[at + 2], triangles); triangle += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = index.getX(triangle * 3 + corner);
        let local = used.get(vertex);
        if (local === undefined) {
          local = positions.length / 3;
          point.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
          positions.push(point.x, point.y, point.z);
          used.set(vertex, local);
        }
        corners.push(local);
      }
    }
  }
  if (!corners.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geometry.setIndex(new THREE.BufferAttribute(positions.length / 3 > 65535 ? new Uint32Array(corners) : new Uint16Array(corners), 1));
  const identity = new THREE.Matrix4();
  const proxy = {
    geometry,
    matrixWorld: identity,
    updateWorldMatrix() {},
    userData: {},
    visible: true,
    isProxy: true,
    isRange: true,
    dispose: () => geometry.dispose(),
  };
  proxies.set(cacheKey, proxy);
  let ranges = 0;
  for (const item of proxies.values()) if (item.isRange) ranges += 1;
  for (const [oldKey, old] of proxies) {
    if (ranges <= RANGE_LIMIT) break;
    if (!old.isRange) continue;
    proxies.delete(oldKey);
    old.dispose();
    ranges -= 1;
  }
  return proxy;
}

/** Сколько кусков-островов сейчас в памяти (тест). */
export const islandProxyCount = () => proxies.size;
