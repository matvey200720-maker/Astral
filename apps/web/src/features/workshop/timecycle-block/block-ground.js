/*
 * Пол полёта над землёй карты (19.10.2026, «полёт начинается слишком высоко»).
 *
 * Кадр «Фонарей» стоит на настоящей дороге: земля лежит где-то около −9,6 м от якоря секции и
 * уходит вниз и вверх по улице. Плоский пол полёта (`floor` камеры) был 0,8 м от якоря — выше
 * дороги почти на девять метров, и при первом же нажатии W камера подпрыгивала на девять метров.
 * Здесь пол — сама земля под камерой: луч вниз от глаза находит первую поверхность, смотрящую
 * вверх (дорога, тротуар, крыша), и камера не опускается ближе `clearance` к ней — ни на ровном
 * месте, ни на склоне, ни когда человек зажал Ctrl, чтобы лететь вниз. Выше пола камера
 * свободна, у неё нет «потолка»; горизонтально стены она не чувствует.
 *
 * Луч не бесплатный (сотни деталей партиями), поэтому высота земли помнится: пересчёт — когда глаз
 * ушёл от прошлой точки больше чем на `STEP` метров или прошло `MAX_AGE_MS`.
 */

import * as THREE from "three";

/** Ближе к земле камера не опускается: рост человека без полуметра. */
export const GROUND_CLEARANCE = 0.9;
/** Дальше этого от прошлого замера земля считается заново, м. */
const STEP = 1.5;
/** Замер старше этого считается заново, мс. */
const MAX_AGE_MS = 300;
/** Луч начинается чуть выше глаза: камера стоит на земле, а не под ней. */
const RAY_LIFT = 0.3;
/** Выше этого значения нормали (по Y) поверхность смотрит вверх — на неё можно встать. */
const WALKABLE_NORMAL_Y = 0.3;
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Высота земли под точкой `(x, z)` в осях кадра (Y вверх) от высоты `y` — или `null`, если под
 * точкой ничего нет. `root` — всё, что стоит в кадре.
 */
export function groundHeight(root, x, y, z, raycaster = new THREE.Raycaster()) {
  raycaster.set(new THREE.Vector3(x, y + RAY_LIFT, z), DOWN);
  raycaster.far = 2000;
  const hits = raycaster.intersectObject(root, true);
  for (const hit of hits) {
    if (!hit.object?.visible) continue;
    /* Поверхность смотрит вверх: нормаль грани в осях мира. Без грани (точки, линии) — не земля. */
    if (!hit.face) continue;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (normal.y < WALKABLE_NORMAL_Y) continue;
    return hit.point.y;
  }
  return null;
}

/**
 * Функция `collide(from, to)` для общей камеры (`stage-camera.js`): куда можно сдвинуться — не ниже
 * земли под новой точкой плюс `clearance`. Оси — кадра, Y вверх.
 *
 * @param {object} options
 * @param {THREE.Object3D} options.root — всё, что стоит в кадре
 * @param {number} [options.clearance]
 * @param {() => number} [options.now] — часы, мс (в тесте — свои)
 * @param {(x: number, y: number, z: number) => (number | null)} [options.heightAt] — свой замер земли
 */
export function createGroundFloor({ root, clearance = GROUND_CLEARANCE, now = () => performance.now(), heightAt = null }) {
  const raycaster = new THREE.Raycaster();
  const measure = heightAt || ((x, y, z) => groundHeight(root, x, y, z, raycaster));
  const last = { x: Number.NaN, z: Number.NaN, at: -Infinity, ground: null };
  return function collide(from, to) {
    const t = now();
    const moved = Math.hypot(to.x - last.x, to.z - last.z);
    if (!(moved < STEP) || t - last.at > MAX_AGE_MS) {
      /* Луч — от выше из двух точек: идёт вниз и вверх по склону, а крыша над головой не берётся за землю. */
      const ground = measure(to.x, Math.max(from.y, to.y), to.z);
      last.x = to.x;
      last.z = to.z;
      last.at = t;
      last.ground = ground;
    }
    if (last.ground === null || !Number.isFinite(last.ground)) return to;
    const floor = last.ground + clearance;
    if (to.y >= floor) return to;
    const out = to.clone();
    out.y = floor;
    return out;
  };
}
