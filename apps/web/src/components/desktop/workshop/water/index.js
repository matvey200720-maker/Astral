/*
 * Вход в редактор воды.
 *
 * Один файл на всю папку, чтобы реестру редакторов (`useWorkshopEditors.jsx`)
 * не приходилось знать её устройство: он импортирует папку, а что внутри —
 * дело редактора. Соседние редакторы устроены так же.
 */

export { default } from "./WaterStudio.jsx";
export { default as WaterStudio } from "./WaterStudio.jsx";
export { createWaterScene } from "./water-scene.js";
export * from "./water-model.js";
