/*
 * Вход в редактор растительности.
 *
 * Один файл на всю папку, чтобы реестру редакторов (`useWorkshopEditors.jsx`)
 * не приходилось знать её устройство: он импортирует папку, а что внутри —
 * дело редактора. Соседние редакторы устроены так же.
 */

export { default } from "./VegetationStudio.jsx";
export { default as VegetationStudio } from "./VegetationStudio.jsx";
export { createVegetationScene } from "./vegetation-scene.js";
export * from "./vegetation-model.js";
