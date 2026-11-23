/*
 * Поток деревьев луча (`ray-accel.js`, ТЗ 26.10.2026, перф щелчка и наведения). Дерево коробок над треугольниками сетки зала на 800 тысяч
 * треугольников строится сотни миллисекунд на ×1 — в окне это были бы секунды рывков на закрытой ×4, здесь это свой поток. Вершины и индексы
 * приходят копией (окну они нужны для отрисовки), деревья уходят окну без копии.
 */

import { buildTriangleBvh, bvhTransferList } from "./triangle-bvh.js";

self.onmessage = (event) => {
  const { id, meshes } = event.data;
  try {
    const trees = meshes.map((mesh) => (mesh ? buildTriangleBvh(mesh.positions, mesh.indices) : null));
    self.postMessage({ id, trees }, bvhTransferList(trees));
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
