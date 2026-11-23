/*
 * Отделённые куски развёртки на моделях кадра «Ганпак». Перед мазком по общему куску студия переносит его на свободное место листа и пишет это в `project.detached`
 * (`gun-detach.js`, `syncDetached` в `gun-scene.js`), и покраска лежит уже там. Модель в кадре должна смотреть на тот же лист: без переноса мазков на стволе не видно.
 *
 * Здесь куски только ставятся: своя развёртка хранится у сетки и возвращается перед каждым применением, поэтому правка ствола или «Отменить» в студии не копятся.
 * Покраска приходит готовая (из студии, из хранилища, из черновика), в этом кадре холстов нет, переносить пиксели незачем.
 */

import * as THREE from "three";
import { mapUv, trianglesBox, unpackTriangles } from "../gun-detach.js";
import { meshUvIslands } from "../gun-uv-mesh.js";

/* Насколько рамка куска может разойтись с записью: дальше — запись не от этой модели. */
const BOX_SLOP = 2e-3;

/* Сетка без индексов и с развёрткой float: у каждого треугольника свои вершины, часть куска едет без соседей. */
function stateOf(mesh) {
  if (mesh.userData.astralPackUv) return mesh.userData.astralPackUv;
  const geometry = mesh.geometry;
  const islands = meshUvIslands(geometry);
  if (!islands) return null;
  if (geometry.index) {
    const flat = geometry.toNonIndexed();
    for (const [name, attribute] of Object.entries(flat.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(null);
    flat.dispose();
  }
  const source = geometry.attributes.uv;
  const pristine = new Float32Array(source.count * 2);
  for (let vertex = 0; vertex < source.count; vertex += 1) {
    pristine[vertex * 2] = source.getX(vertex);
    pristine[vertex * 2 + 1] = source.getY(vertex);
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(pristine.slice(), 2));
  const state = { islands, pristine, numbers: islands.slice() };
  mesh.userData.astralPackUv = state;
  return state;
}

function restore(mesh) {
  const state = mesh.userData.astralPackUv;
  if (!state) return;
  const uv = mesh.geometry.attributes.uv;
  uv.array.set(state.pristine);
  uv.needsUpdate = true;
  state.numbers = state.islands.slice();
}

function trianglesOfIsland(item, numbers, island) {
  const total = Math.floor(item.mesh.geometry.attributes.position.count / 3);
  const ranges = item.groups?.length
    ? item.groups.map((group) => [Math.floor(group.start / 3), Math.min(total, Math.floor((group.start + group.count) / 3))])
    : [[0, total]];
  const out = [];
  for (const [start, end] of ranges) for (let triangle = start; triangle < end; triangle += 1) if (numbers[triangle] === island) out.push(triangle);
  return out;
}

function placeRecord(item, record, forward, inverse) {
  const state = item && stateOf(item.mesh);
  if (!state) return;
  const { numbers } = state;
  const triangles = record.part ? [...unpackTriangles(record.part.triangles)] : trianglesOfIsland(item, numbers, record.island);
  if (!triangles.length || (record.part && triangles.some((triangle) => numbers[triangle] !== record.part.of))) return;
  const uv = item.mesh.geometry.attributes.uv;
  const point = new THREE.Vector2();
  const uvs = [];
  for (const triangle of triangles)
    for (let corner = 0; corner < 3; corner += 1) {
      point.fromBufferAttribute(uv, triangle * 3 + corner).applyMatrix3(forward);
      uvs.push(point.x, point.y);
    }
  const box = trianglesBox(uvs);
  if (!box.every((value, index) => Math.abs(value - record.box[index]) <= BOX_SLOP)) return;
  if (record.part) for (const triangle of triangles) numbers[triangle] = record.island;
  for (const [order, triangle] of triangles.entries())
    for (let corner = 0; corner < 3; corner += 1) {
      const at = order * 6 + corner * 2;
      const [u, v] = mapUv(record, uvs[at], uvs[at + 1]);
      point.set(u, v).applyMatrix3(inverse);
      uv.setXY(triangle * 3 + corner, point.x, point.y);
    }
  uv.needsUpdate = true;
}

/**
 * Поставить куски записи `detached` (`{ деталь: [запись] }`) на модель. `stock` — детали модели в кадре: `Map<деталь, { placement, meshes: [{ mesh, groups }] }>`,
 * `meshes` — в порядке студии, номер сетки в записи считается по нему.
 */
export function applyDetached(stock, detached = {}) {
  const meshes = new Set();
  for (const { meshes: items } of stock.values()) for (const item of items) meshes.add(item.mesh);
  for (const mesh of meshes) restore(mesh);
  for (const [name, records] of Object.entries(detached)) {
    const entry = stock.get(name);
    if (!entry?.placement || !records?.length) continue;
    entry.placement.updateMatrix();
    const forward = entry.placement.matrix;
    const inverse = forward.clone().invert();
    for (const record of records) placeRecord(entry.meshes[record.mesh], record, forward, inverse);
  }
}
