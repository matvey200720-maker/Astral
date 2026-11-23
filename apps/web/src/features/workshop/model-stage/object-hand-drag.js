import * as THREE from "three";

/*
 * Вещь в руке: протяжка своей вещи кадра мышью (владелец 01.11.2026: «зажимаешь левую кнопку мыши … двигать лево, вправо, вверх, вниз,
 * а если хочешь передвинуть вперёд или назад, то нажимаешь W или S и она двигается вперёд-назад»).
 *
 * Вещь едет по плоскости, обращённой к камере: нормаль — направление взгляда, глубина — расстояние от глаза до точки захвата вдоль взгляда.
 * Точка под курсором — это пересечение его луча с этой плоскостью, и оно всегда есть (косинус луча со взглядом не меньше косинуса
 * половины диагонали кадра), поэтому вещь идёт за курсором 1:1 и остаётся на своей дистанции. Раньше луч пересекали с горизонтальной
 * плоскостью на высоте точки захвата: при взгляде почти вдоль пола точка уходила на десятки метров, а выше горизонта пересечения не
 * было вовсе — вещь замирала (`orbit-stage.js`, `dragDelta`).
 *
 * W и S меняют глубину: вещь едет по лучу курсора от камеры и к ней, поэтому остаётся под курсором, а не уходит в сторону. Скорость
 * зависит от дистанции — `HAND_DEPTH_RATE` её долей в секунду, так что вблизи вещь не проскакивает мимо глаза, а вдали не ползёт, — но не
 * меньше `HAND_SPEED_MIN` и не больше `HAND_SPEED_MAX` метров в секунду: при виде на весь ангар (камера в сотне метров) вещь за секунду
 * уходила на полсотни метров и пропадала из кадра (песочница 01.11.2026). Пределы глубины — от ближней плоскости камеры и до
 * `HAND_DEPTH_REACH`-кратного захватного расстояния.
 */

/* Доля дистанции в секунду, на которую уходит вещь при зажатой W или S: на пяти метрах — 3 м/с. */
export const HAND_DEPTH_RATE = 0.6;
/* Но не медленнее и не быстрее: метров в секунду. */
export const HAND_SPEED_MIN = 0.5;
export const HAND_SPEED_MAX = 14;
/* Насколько дальше и ближе захватного расстояния можно увести вещь, раз. */
export const HAND_DEPTH_REACH = 20;
/* Луч, почти параллельный плоскости, плоскость не берёт: у камеры с таким углом обзора до него не дойти, это страховка. */
const MIN_COSINE = 0.05;

const view = new THREE.Vector3();
const toStart = new THREE.Vector3();

/**
 * Вещь в руке для одной протяжки.
 *
 * @param {THREE.PerspectiveCamera} camera — камера кадра, уже поставленная (`eye.apply()`)
 * @param {THREE.Vector3} start — точка захвата в сцене (куда попал луч при нажатии)
 * @returns {{ start: THREE.Vector3, depth: number, follow(ray: THREE.Ray): THREE.Vector3 | null, push(direction: number, seconds: number): void }}
 */
export function createHandDrag(camera, start) {
  camera.getWorldDirection(view);
  const first = Math.max(toStart.copy(start).sub(camera.position).dot(view), camera.near * 2);
  const low = Math.max(camera.near * 2, first / HAND_DEPTH_REACH);
  const high = Math.max(low, Math.min(camera.far * 0.9, first * HAND_DEPTH_REACH));
  const point = start.clone();
  const hand = {
    start: start.clone(),
    depth: first,
    /** Точка луча на плоскости вещи; `null` — луч идёт мимо плоскости, вещь стоит. Возвращается один и тот же вектор. */
    follow(ray) {
      camera.getWorldDirection(view);
      const cosine = ray.direction.dot(view);
      if (cosine < MIN_COSINE) return null;
      return point.copy(ray.direction).multiplyScalar(hand.depth / cosine).add(ray.origin);
    },
    /** W (`direction` 1) отводит вещь от камеры, S (−1) — приближает; `seconds` — шаг кадра. */
    push(direction, seconds) {
      if (!direction || !(seconds > 0)) return;
      const speed = Math.min(HAND_SPEED_MAX, Math.max(HAND_SPEED_MIN, hand.depth * HAND_DEPTH_RATE));
      hand.depth = Math.min(high, Math.max(low, hand.depth + Math.sign(direction) * speed * seconds));
    },
  };
  return hand;
}
