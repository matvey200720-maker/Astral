import { installLacksChoice } from "./needs-choice.js";

/*
 * Последний рубеж «Установить» у одежды (владелец, 15.11.2026: «мне бы предлагался на что-то поставить замененку, как с футболкой»): общая установка оболочки (`install`) не ставит вещь вида `pick` / `gloves` без выбора
 * `clothingChoice` — ни плитка, ни главная, ни корзина, ни чужой экран. Вместо этого называет причину и открывает карточку с окном «Сделать заменёнку». Тихая попытка `useWaitingUpdates` (`waitingAuto`) выбора спросить
 * не может: молчит и ничего не ставит. Грузится лениво (`import()` у оболочки), только когда карточка похожа на одежду (`looksLikeClothing`).
 */

/**
 * Ответ `true` — вещь без выбора, установка не идёт. `notify(текст)` и `openMod(мод)` — оболочки, `word(имя)` — слово «Выберите, на что поставить …» на языке окна.
 */
export function openCardWithoutChoice(mod, options, { notify, openMod, word }) {
  if (!installLacksChoice(mod)) return false;
  if (!options?.waitingAuto) {
    notify(word(mod.name));
    openMod(mod);
  }
  return true;
}
