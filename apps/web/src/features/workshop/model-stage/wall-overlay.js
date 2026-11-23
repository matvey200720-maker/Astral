/*
 * Выбранная стена в 3D-кадре (3Б ТЗ 18.10.2026): штрихи по её треугольникам и контур по кромке группы — видно, на
 * какой именно стене открыта «Студия». Задача 10Б (18.10.2026): прежде это была сплошная заливка и линия; теперь та же
 * подсветка штрихами и контуром, что и у всего выбранного в мастерской (`selection-highlight.js`), только янтарная —
 * стена внутри выбранной части здания (белой) не должна сливаться с ней. Объект кадра (`ModelStage` `objects`):
 * стоит в тех же осях, что сцена, чуть над стеной (2 см по нормали), чтобы не мерцать вместе с ней. Стена держится,
 * пока открыта студия, поэтому штрихи не гаснут, как после щелчка, — это метка состояния, а не вспышка.
 *
 * `wall` — стена из `texture-studio/wall-face.js` (`fill`, `boundary`, `basis.normal`).
 */

import * as THREE from "three";
import { createSelectionHighlight } from "./selection-highlight.js";

/* Штрихи и контур поднимаем над стеной: сантиметры, а не метры. */
const LIFT = 0.02;
/*
 * Цвет выбранной стены — свой, не акцент: акцент в этой теме белый, и контур части здания
 * (то же выбранное, но шире — вся часть) был бы неотличим от стены под щелчком.
 */
const WALL_COLOUR = "#ffc857";
const WALL_INK = "#0a0a0b";

const lifted = (flat, normal) => {
  const out = new Float32Array(flat.length);
  for (let at = 0; at < flat.length; at += 3) {
    out[at] = flat[at] + normal[0] * LIFT;
    out[at + 1] = flat[at + 1] + normal[1] * LIFT;
    out[at + 2] = flat[at + 2] + normal[2] * LIFT;
  }
  return out;
};

/** Объект кадра для стены `wall` (группа со штрихами и контуром) и функция, что освобождает его ресурсы. */
export function createWallOverlay(wall) {
  const group = new THREE.Group();
  group.name = "wall-overlay";
  const layer = createSelectionHighlight({ parent: group, invalidate: () => {}, palette: { accent: WALL_COLOUR, ink: WALL_INK } });
  let geometry = null;
  if (wall.fill?.length) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(lifted(wall.fill, wall.basis.normal), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((wall.fill.length / 3) * 2), 2));
    /* Слою подсветки нужны геометрия и мировая матрица: стена лежит в осях сцены. */
    layer.set("select", [{ geometry, matrixWorld: new THREE.Matrix4(), updateWorldMatrix() {}, userData: {} }]);
  }
  return {
    object: group,
    dispose() {
      layer.dispose();
      geometry?.dispose();
    },
  };
}
