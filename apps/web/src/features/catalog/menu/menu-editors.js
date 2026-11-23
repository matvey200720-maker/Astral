/*
 * Моды без редактора мастерской («Прочее» окна) ищут себе пункт меню по слоту: оптимизация — своя полка,
 * шрифт и цвет HUD — к шрифтам. Части редуксов (`member`) остаются где были: отдельно их в колонке не показывают.
 * Модуль без зависимостей: его читает разбор каталога (`catalog-page-mods.js`), он в ленивом куске каталога.
 */
const SLOT_EDITORS = Object.freeze({
  optimization: "optimization",
  "fast-entry": "optimization",
  font: "fonts",
  hudcolor: "fonts",
});

export function menuEditorOf(mod, editor, member = false) {
  if (member || editor !== "other") return editor;
  return SLOT_EDITORS[String(mod?.catalogSlot || mod?.slot || "")] || editor;
}
