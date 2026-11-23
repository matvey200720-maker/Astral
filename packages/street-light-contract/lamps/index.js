/*
 * Редактор фонарей мастерской: работа, готовые виды, частицы и сборка правок.
 *
 * Живёт внутри пакета контракта фонарей, а не отдельным пакетом, по одной
 * причине: новый пакет воркспейса на машинах, которые подтягивают main
 * ярлыком, не связан в node_modules до `npm install`, и первый же импорт
 * уронил бы приложение. Этот пакет связан везде, а подпуть `./lamps`
 * добавляет только его package.json.
 *
 * Всё здесь — чистые функции без Node и DOM: их читают и окно, и главный
 * процесс, и тесты.
 */

export * from "./palette.js";
export * from "./families.js";
export * from "./particles.js";
export * from "./project.js";
export * from "./presets.js";
export * from "./compile.js";
export * from "./recolour.js";
export * from "./light-model.js";
export * from "./bridges.js";
export * from "./bridge-lod-points.js";
export * from "./pole.js";
export * from "./pole-shape.js";
export * from "./decor.js";
export * from "./pole-presets.js";
export * from "./street-heads.js";
