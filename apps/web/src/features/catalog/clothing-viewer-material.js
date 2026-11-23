/*
 * Материал одежды в окне «3D» (карточка каталога, «Установить», окно «На что поставить?»). Альфа текстуры одежды — маска блеска, а не прозрачность: обычные материалы выводятся непрозрачными. Кроме двух видов:
 * - тату: альфа — сам рисунок, под ним в модели лежит кожа из той же сетки (`astralUnderlay`);
 * - вырез по альфе (волосы, борода, усы, мех: шейдеры `ped_hair_spiked`, `ped_hair_cutout_alpha`, `ped_fur`, в GLB это `alphaMode: MASK`, three.js кладёт порог в `alphaTest`): альфа листа — рисунок прядей. Без выреза
 * каждая прядь превращалась в сплошную плашку (16.11.2026: «борода рублеными осколками» в окне цели; обложка и «На человеке» рисуют вырез правильно).
 */

/**
 * Приводит материал вещи к виду просмотрщика. `THREE` — модуль three, `maxAnisotropy` — предел видеочипа. Тату остаётся прозрачным рисунком, вырез держит порог из GLB (но не нулевой и не выше единицы), остальное — непрозрачное.
 */
export function prepareClothingMaterial(THREE, maxAnisotropy, material, { tattoo }) {
  const drawing = Boolean(tattoo && material.transparent);
  /* Порог выреза GLTFLoader кладёт в `alphaTest` только у `MASK`; у прозрачных (`BLEND`) он ноль, и они остаются непрозрачными, как раньше. */
  const cutoff = !tattoo && material.alphaTest > 0 ? Math.min(1, material.alphaTest) : 0;

  material.side = THREE.DoubleSide;
  material.transparent = drawing;
  material.opacity = 1;
  material.alphaTest = cutoff;
  material.depthWrite = !drawing;
  material.depthTest = true;

  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.anisotropy = maxAnisotropy;
    material.map.needsUpdate = true;
    material.color?.set(0xffffff);
  }
  if (material.normalMap) {
    material.normalMap.colorSpace = THREE.NoColorSpace;
    material.normalMap.anisotropy = maxAnisotropy;
    material.normalMap.needsUpdate = true;
  }

  material.needsUpdate = true;
}
