// Зона Z6, часть 1: выбор указателем, места на вещи, мерки ствола, экранные координаты.
// Только читает состояние сцены (ctx) и пускает лучи через общий ctx.ray.
//
// Особенность, которая оставлена как есть: матрицы камеры здесь не обновляются.
// Проекция и выбор сразу после поворота вида идут по матрицам последнего кадра.

import { rasterizeZone } from "./gun-zones.js";
import { decorationWrap } from "@modovik/gun-studio";
import * as THREE from "three";

// Места на вещи для наклейки. from — с какой стороны пускается луч (вектор от вещи к началу луча):
// +z, −z, +x, −x; x и y — где стоять на коробке модели.
export const PLACEMENTS = {
  chest: { from: [0, 0, 1], x: 0, y: 0.68 },
  heart: { from: [0, 0, 1], x: 0.24, y: 0.72 },
  back: { from: [0, 0, -1], x: 0, y: 0.68 },
  "sleeve-left": { from: [1, 0, 0], x: 0, y: 0.8 },
  "sleeve-right": { from: [-1, 0, 0], x: 0, y: 0.8 },
  front: { from: [0, 0, 1], x: 0, y: 0.5 },
  "body-chest": { from: [0, 0, 1], x: 0, y: 0.76 },
  "body-heart": { from: [0, 0, 1], x: 0.12, y: 0.78 },
  "body-back": { from: [0, 0, -1], x: 0, y: 0.76 },
  "body-sleeve-left": { from: [1, 0, 0], x: 0, y: 0.79 },
  "body-sleeve-right": { from: [-1, 0, 0], x: 0, y: 0.79 },
  "gun-top": { from: [0, 0, 1], x: 0.12, y: 0.8 },
  "gun-rear": { from: [0, 0, 1], x: -0.5, y: 0.5 },
  "gun-front": { from: [0, 0, 1], x: 0.55, y: 0.62 },
};

const DEFAULT_HEIGHT = 0.72;
const PROBE_HEIGHTS = [0.84, 0.72, 0.6, 0.48, 0.36, 0.24];

// номер оси 0 — x, 1 — y, любой другой — z
const axisKey = (axis) => ["x", "y", "z"][axis] ?? "z";
const axisValue = (vector, axis) => vector[axisKey(axis)];
const setAxisValue = (vector, axis, value) => {
  vector[axisKey(axis)] = value;
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));

// Размер и середина коробки.
const measureBox = (box) => ({
  size: box.getSize(new THREE.Vector3()),
  middle: box.getCenter(new THREE.Vector3()),
});

// ---------------------------------------------------------------------------
// Лучи
// ---------------------------------------------------------------------------

// Наводит общий луч на точку холста под указателем.
const aimThroughPointer = (ctx, clientX, clientY) => {
  const rect = ctx.canvas.getBoundingClientRect();
  const ndcX = (2 * (clientX - rect.left)) / rect.width - 1;
  const ndcY = (-2 * (clientY - rect.top)) / rect.height + 1;
  ctx.pointer.set(ndcX, ndcY);
  ctx.ray.setFromCamera(ctx.pointer, ctx.camera);
};

const castAtRoot = ({ ray, root }) => ray.intersectObject(root, true);

// Наводит общий луч: точка start и направление direction заданы в осях space.
// Сами векторы не трогает; возвращает начало луча в мире.
const aimFrom = (ray, space, start, direction) => {
  const origin = space.localToWorld(start.clone());
  ray.set(origin, direction.clone().transformDirection(space.matrixWorld));
  return origin;
};

// ---------------------------------------------------------------------------
// Выбор поверхности и мест
// ---------------------------------------------------------------------------

const pickSurface = (ctx, clientX, clientY) => {
  if (!ctx.root) return null;
  aimThroughPointer(ctx, clientX, clientY);
  return ctx.ops.describeHit(castAtRoot(ctx), ctx.camera.position);
};

const pickDecoration = (ctx, clientX, clientY) => {
  if (!ctx.root) return "";
  aimThroughPointer(ctx, clientX, clientY);
  return ctx.decorations.pick(ctx.ray);
};

// Зеркало по толщине: точка отражается от середины коробки по z, нормаль меняет знак по z.
// Луч пускается чуть снаружи отражённой точки внутрь и ищет поверхность с другой стороны.
const pickMirror = (ctx, hit) => {
  if (!ctx.root || !hit?.point) return null;
  const { point, normal } = hit;
  const midZ = ctx.bounds.getCenter(new THREE.Vector3()).z;
  const outward = new THREE.Vector3(normal.x, normal.y, -normal.z).normalize();
  const reach = ctx.span * 0.06;
  const range = reach * 2.5 * ctx.shape.scale;
  const start = new THREE.Vector3(point.x, point.y, 2 * midZ - point.z).addScaledVector(outward, reach);
  ctx.holder.updateMatrixWorld(true);
  const origin = aimFrom(ctx.ray, ctx.holder, start, outward.negate());
  return ctx.ops.describeHit(castAtRoot(ctx), origin, range);
};

// Место по названию: цель на коробке модели, луч подходит с описанной стороны.
const pickPlacement = (ctx, place) => {
  const spot = PLACEMENTS[place];
  if (!ctx.root || !spot) return null;
  const { bounds, span } = ctx;
  const { size, middle } = measureBox(bounds);
  const approach = new THREE.Vector3(...spot.from);
  const target = new THREE.Vector3(middle.x, bounds.min.y + spot.y * size.y, middle.z);
  // при подходе вдоль x (рукава) сдвига по x нет: цель в середине коробки
  if (approach.x === 0) target.x += size.x * spot.x * 0.5;
  const start = target.addScaledVector(approach, span * 2);
  ctx.holder.updateMatrixWorld(true);
  const origin = aimFrom(ctx.ray, ctx.holder, start, approach.negate());
  return ctx.ops.describeHit(castAtRoot(ctx), origin);
};

// Высоты боковых проб (доли высоты коробки): сначала желаемая, потом остальные от ближней к ней.
const sideProbes = (height) => {
  const asked = height == null ? NaN : Number(height);
  const wanted = Number.isFinite(asked) ? asked : DEFAULT_HEIGHT;
  const gap = (probe) => Math.abs(probe - wanted);
  return [wanted, ...[...PROBE_HEIGHTS].sort((a, b) => gap(a) - gap(b))];
};

// Место на стволе по доле длины вдоль длинной оси: луч сверху или (любое другое side) сбоку со стороны камеры.
const pickAlong = (ctx, { along = 0.5, side = "side", height = null }) => {
  const { root, camera, zoneFrame } = ctx;
  if (!(root && zoneFrame)) return null;
  root.updateMatrixWorld(true);
  const { box, axis, muzzle } = zoneFrame;
  const across = axis === 2 ? 0 : 2;
  const { size, middle } = measureBox(box);
  const length = axisValue(size, axis) || ctx.span;

  // доля длины отсчитывается от нижнего края коробки при положительном знаке дула, иначе от верхнего
  const shift = clamp01(Number(along) || 0) * length;
  const position = muzzle > 0 ? axisValue(box.min, axis) + shift : axisValue(box.max, axis) - shift;

  // камера слева или справа от середины по поперечной оси (на самой середине — справа)
  const eye = root.worldToLocal(camera.position.clone());
  const cameraSide = axisValue(eye, across) < axisValue(middle, across) ? -1 : 1;

  const start = middle.clone();
  setAxisValue(start, axis, position);
  const direction = new THREE.Vector3();
  const cast = () => {
    const origin = aimFrom(ctx.ray, root, start, direction);
    return ctx.ops.describeHit(castAtRoot(ctx), origin);
  };

  if (side === "top") {
    start.y = length + box.max.y;
    direction.y = -1;
    return cast();
  }

  setAxisValue(start, across, axisValue(middle, across) + cameraSide * length);
  setAxisValue(direction, across, -cameraSide);
  for (const probe of sideProbes(height)) {
    start.y = box.min.y + probe * size.y;
    const hit = cast();
    if (hit) return hit;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Мерки
// ---------------------------------------------------------------------------

// Пустой холст нужных размеров для листа маски.
const blankCanvas = (width, height) => Object.assign(document.createElement("canvas"), { width, height });

const zoneMask = (ctx, name, zone) => {
  const entry = ctx.entries.find((item) => item.name === name);
  if (!(entry && ctx.zoneFrame)) return null;
  return rasterizeZone(entry, ctx.zoneFrame, zone, blankCanvas);
};

// Вершины сетки в осях корня — плоским списком xyz. У скелетной сетки вершина берётся «в позе».
const rootPositions = (node, inverse) => {
  const { position } = node.geometry.attributes;
  const toRoot = inverse.clone().multiply(node.matrixWorld);
  const posed = node.isSkinnedMesh && node.getVertexPosition;
  const point = new THREE.Vector3();
  const positions = new Float32Array(3 * position.count);
  for (let index = 0; index < position.count; index += 1) {
    if (posed) node.getVertexPosition(index, point);
    else point.fromBufferAttribute(position, index);
    positions.set(point.applyMatrix4(toRoot).toArray(), index * 3);
  }
  return positions;
};

// Сетки, которые идут в мерку: свои, не служебные и с позициями вершин.
const measuredMeshes = (root) => {
  const meshes = [];
  root.traverse((node) => {
    if (node.isMesh && !node.userData.astralOverlay && node.geometry.attributes.position) meshes.push(node);
  });
  return meshes;
};

const wrapProfile = (ctx, zone) => {
  const { root } = ctx;
  if (!root) return null;
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const samples = measuredMeshes(root).map((node) => ({
    positions: rootPositions(node, inverse),
    indices: node.geometry.index ? node.geometry.index.array : null,
  }));
  return decorationWrap(samples, { zone });
};

// ---------------------------------------------------------------------------
// Экранные координаты
// ---------------------------------------------------------------------------

const projectPoint = (ctx, space, point) => {
  space.updateMatrixWorld(true);
  const projected = space.localToWorld(new THREE.Vector3(point.x, point.y, point.z)).project(ctx.camera);
  const { left, top, width, height } = ctx.canvas.getBoundingClientRect();
  return {
    depth: projected.z,
    screen: {
      x: left + ((projected.x + 1) / 2) * width,
      y: top + ((1 - projected.y) / 2) * height,
    },
  };
};

const screenOf = (ctx, point) => {
  if (!ctx.root || !point) return null;
  return projectPoint(ctx, ctx.root, point).screen;
};

const screenOfSticker = (ctx, point) => {
  if (!ctx.root || !point) return null;
  const { depth, screen } = projectPoint(ctx, ctx.holder, point);
  return depth < -1 || depth > 1 ? null : screen;
};

export const attachPickZone = (ctx) =>
  Object.assign(ctx.ops, {
    pickSurface(clientX, clientY) {
      return pickSurface(ctx, clientX, clientY);
    },
    pickMirror(hit) {
      return pickMirror(ctx, hit);
    },
    zoneMask(name, zone) {
      return zoneMask(ctx, name, zone);
    },
    pickPlacement(place) {
      return pickPlacement(ctx, place);
    },
    pickDecoration(clientX, clientY) {
      return pickDecoration(ctx, clientX, clientY);
    },
    pickAlong(options = {}) {
      return pickAlong(ctx, options);
    },
    wrapProfile(zone = "barrel") {
      return wrapProfile(ctx, zone);
    },
    screenOf(point) {
      return screenOf(ctx, point);
    },
    screenOfSticker(point) {
      return screenOfSticker(ctx, point);
    },
  });
