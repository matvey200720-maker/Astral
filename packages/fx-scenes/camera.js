/*
 * Камера кадра и проекция точек (`docs/fx-scenes.md`, §2): мир GTA ↔ экран.
 *
 * Камера — как её отдаёт игра: положение и углы `rot { pitch, roll, yaw }` в градусах, порядок ZXY (`GET_CAM_ROT`), `fovV` — вертикальный угол
 * обзора. Матрица `Rz(yaw) · Rx(pitch) · Ry(roll)` переводит оси камеры (вправо +X, вперёд +Y, вверх +Z) в мир: при нулевых углах камера смотрит
 * вдоль +Y, `forward = (−sin yaw · cos pitch, cos yaw · cos pitch, sin pitch)`. Экран — `[u, v]` от верхнего левого угла, `[0,1]`; глубина —
 * расстояние вдоль оси взгляда (view-space Z), метры; пикселы квадратные.
 *
 * Для мастерской авторитетен `screen` из нативов игры; проекция из `world` — проверка стенда и перенос между системами.
 */

const RAD = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Направление взгляда камеры из углов GTA (градусы). */
export function forwardFromRot(rot = {}) {
  const pitch = (rot.pitch || 0) * RAD;
  const yaw = (rot.yaw || 0) * RAD;
  return [-Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
}

/** Оси камеры в мире: `{ right, forward, up }` — единичные векторы. */
export function cameraAxes(camera) {
  const pitch = (camera.rot?.pitch || 0) * RAD;
  const roll = (camera.rot?.roll || 0) * RAD;
  const yaw = (camera.rot?.yaw || 0) * RAD;
  const [cp, sp, cr, sr, cy, sy] = [Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll), Math.cos(yaw), Math.sin(yaw)];
  /* Ry(roll) → Rx(pitch) → Rz(yaw), применяется к осям камеры по очереди. */
  const turn = (v) => {
    const a = [v[0] * cr + v[2] * sr, v[1], -v[0] * sr + v[2] * cr];
    const b = [a[0], a[1] * cp - a[2] * sp, a[1] * sp + a[2] * cp];
    return [b[0] * cy - b[1] * sy, b[0] * sy + b[1] * cy, b[2]];
  };
  return { right: turn([1, 0, 0]), forward: turn([0, 1, 0]), up: turn([0, 0, 1]) };
}

const tanHalf = (camera) => Math.tan((camera.fovV * Math.PI) / 360);
const aspectOf = (camera, resolution) => camera.aspect || (resolution ? resolution.width / resolution.height : 16 / 9);

/**
 * Точка мира → `{ screen: [u, v], depthMeters }` или `null`, если она за камерой. Экран может выходить за `[0,1]` — точка вне кадра.
 */
export function projectPoint(camera, world, resolution) {
  const axes = cameraAxes(camera);
  const offset = sub(world, camera.position);
  const depth = dot(offset, axes.forward);
  if (!(depth > 1e-6)) return null;
  const half = tanHalf(camera);
  const ndcX = dot(offset, axes.right) / (depth * half * aspectOf(camera, resolution));
  const ndcY = dot(offset, axes.up) / (depth * half);
  return { screen: [(ndcX + 1) / 2, (1 - ndcY) / 2], depthMeters: depth };
}

/** Экранная точка и глубина → точка мира (обратное к `projectPoint`). */
export function unprojectPoint(camera, screen, depthMeters, resolution) {
  const axes = cameraAxes(camera);
  const half = tanHalf(camera);
  const x = (screen[0] * 2 - 1) * depthMeters * half * aspectOf(camera, resolution);
  const y = (1 - screen[1] * 2) * depthMeters * half;
  return [0, 1, 2].map((i) => camera.position[i] + axes.right[i] * x + axes.up[i] * y + axes.forward[i] * depthMeters);
}

/** Все опорные точки сцены: `[{ name, anchor }]` — для проверок и обхода (дуло, цель, веер, кости, кости кадров серии). */
export function sceneAnchors(scene) {
  const out = [];
  if (scene.muzzle) out.push({ name: "muzzle", anchor: scene.muzzle });
  if (scene.target) out.push({ name: "target", anchor: scene.target });
  (scene.impacts || []).forEach((anchor, index) => out.push({ name: `impacts[${index}]`, anchor }));
  for (const [name, anchor] of Object.entries(scene.bones || {})) out.push({ name: `bones.${name}`, anchor });
  for (const frame of scene.frames || []) for (const [name, anchor] of Object.entries(frame.bones || {})) out.push({ name: `frames[${frame.index}].bones.${name}`, anchor });
  return out;
}

/**
 * Согласованность опор: `screen` и `depthMeters` каждой точки против проекции её `world` камерой сцены. Возвращает те, что расходятся
 * больше допуска: `{ name, pixels, depthError }`. Пустой список — камера и точки сходятся (стенд не ошибся с осями и углами).
 */
export function checkAnchors(scene, { pixels = 3, depthMetres = 0.05 } = {}) {
  const { width, height } = scene.resolution;
  const off = [];
  for (const { name, anchor } of sceneAnchors(scene)) {
    const projected = projectPoint(scene.camera, anchor.world, scene.resolution);
    if (!projected) {
      off.push({ name, pixels: Infinity, depthError: Infinity });
      continue;
    }
    const error = Math.hypot((projected.screen[0] - anchor.screen[0]) * width, (projected.screen[1] - anchor.screen[1]) * height);
    const depthError = Math.abs(projected.depthMeters - anchor.depthMeters);
    if (error > pixels || depthError > Math.max(depthMetres, anchor.depthMeters * 0.01)) off.push({ name, pixels: error, depthError });
  }
  return off;
}

/**
 * Точка вдоль пути пули: `t` 0…1 от дула к цели; экран, глубина и мир интерполируются линейно (обе точки уже спроецированы стендом). Без
 * цели — только дуло.
 */
export function sampleBullet(scene, t, to = scene.target) {
  const { muzzle } = scene;
  if (!muzzle) return null;
  const k = Math.min(1, Math.max(0, t));
  if (!to) return { screen: [...muzzle.screen], depthMeters: muzzle.depthMeters, world: [...muzzle.world] };
  const lerp = (a, b) => a + (b - a) * k;
  return {
    screen: [lerp(muzzle.screen[0], to.screen[0]), lerp(muzzle.screen[1], to.screen[1])],
    depthMeters: lerp(muzzle.depthMeters, to.depthMeters),
    world: muzzle.world.map((value, index) => lerp(value, to.world[index])),
  };
}

/**
 * Камера для three.js (Z вверх): положение, кватернион камеры three (смотрит вдоль −Z, вверх +Y) и параметры проекции. Кватернион собран из
 * осей камеры игры: локальные оси three (x, y, −z) — это (right, up, forward).
 */
export function threeCamera(camera) {
  const { right, up, forward } = cameraAxes(camera);
  const back = forward.map((value) => -value);
  /* Матрица поворота по столбцам (right, up, back) → кватернион. */
  const [m00, m10, m20] = right;
  const [m01, m11, m21] = up;
  const [m02, m12, m22] = back;
  const trace = m00 + m11 + m22;
  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return { position: [...camera.position], rotation: [x, y, z, w], fovY: camera.fovV, aspect: camera.aspect, near: camera.near, far: camera.far };
}
