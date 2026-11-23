/*
 * Одежда на разных слотах (14.10.2026): карточка вещи в «Библиотеке»
 * (`features/library/clothing-placements.js`), строка замены на занятой
 * вещи (`ClothingTargetPicker.jsx`) и подсказка окна «На что поставить?»
 * (`ClothingInstallDialog.jsx`). Русская строка → [uk, en, de, pl].
 */

export const zoneClothingSlots1410 = {
  "На «{item}»": ["На «{item}»", "On “{item}”", "Auf „{item}“", "Na „{item}”"],
  "Заменит «{mod}» на этом слоте («{item}»).": [
    "Замінить «{mod}» на цьому слоті («{item}»).",
    "Will replace “{mod}” in this slot (“{item}”).",
    "Ersetzt „{mod}“ in diesem Slot („{item}“).",
    "Zastąpi „{mod}” w tym slocie („{item}”).",
  ],
  "На «{item}» останется «{mod}»: две заменёнки на одной вещи не встанут. Выбери другую вещь или замени её.": [
    "На «{item}» залишиться «{mod}»: дві заміни на одній речі не вживуться. Обери іншу річ або заміни її.",
    "“{mod}” stays on “{item}”: two replacements cannot share one item. Pick another item or replace it.",
    "Auf „{item}“ bleibt „{mod}“: Zwei Ersetzungen auf einem Teil gehen nicht. Wähle ein anderes Teil oder ersetze sie.",
    "Na „{item}” zostanie „{mod}”: dwóch zamienników na jednej rzeczy nie da się mieć. Wybierz inną rzecz albo go zastąp.",
  ],
  "Мод ляжет на вещь, которая у вас есть на сервере: носите её — видите мод. Моды на разных вещах стоят вместе; если на этой вещи уже стоит заменёнка, мод заменит её — Astral скажет какую.": [
    "Мод ляже на річ, яка у вас є на сервері: носите її — бачите мод. Моди на різних речах стоять разом; якщо на цій речі вже стоїть заміна, мод замінить її — Astral скаже яку.",
    "The mod goes onto an item you own on the server: wear it and you see the mod. Mods on different items stay together; if this item already has a replacement, the mod replaces it — Astral tells you which.",
    "Der Mod kommt auf ein Teil, das Sie auf dem Server besitzen: Tragen Sie es, sehen Sie den Mod. Mods auf verschiedenen Teilen bleiben zusammen; liegt auf diesem Teil schon eine Ersetzung, ersetzt der Mod sie — Astral sagt, welche.",
    "Mod trafi na rzecz, którą masz na serwerze: noś ją, a zobaczysz mod. Mody na różnych rzeczach działają razem; jeśli na tej rzeczy jest już zamiennik, mod go zastąpi — Astral powie który.",
  ],
};
