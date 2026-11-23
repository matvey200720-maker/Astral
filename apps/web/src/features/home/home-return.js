// Возврат на Главную из редактора (владелец, 16.11.2026): вещь с карточки «Мастерской» открылась в редакторе, человек нажал «назад» — Главная стоит на том же месте и на той же карточке,
// а не сверху. Запись возврата делает открыватель (`openModEditor` с `returnPage: "home"`, `returnTop`, `returnPick`) под именем `HOME_RETURN_ID`, «назад» взводит её на пять секунд
// (`confirmEditorReturn`, `features/catalog/editor-return.js`). Главная при показе забирает её тем же способом, что карточка мода (`useEditorReturn` в `ModDetailPage.jsx`).
// Без записи, или когда запись не взведена (человек пришёл из меню, а не нажал «назад»), Главная открывается как обычно, сверху.
import { useLayoutEffect } from "react";
import { claimScroll } from "../../section-memory.js";
import {
  HOME_RETURN_ID,
  peekEditorReturnPick,
  takeEditorReturnTop,
} from "../catalog/editor-return.js";

/** Раздел Главной в оболочке зовётся `overview`: под этим именем его сброс прокрутки (`useSectionScrollReset(contentPage)`) ждёт заявку места. */
export const HOME_SECTION = "overview";

/** Карточка блока, с которой открыли вещь: у каждой в разметке стоит `data-pick` с её ключом (`HomeContinue.jsx`). */
function cardOf(root, pick) {
  if (!root || !pick) return null;
  for (const card of root.querySelectorAll("[data-pick]"))
    if (card.dataset.pick === pick) return card;
  return null;
}

/**
 * Главная при показе забирает запись возврата: ставит прокрутку общего окна туда, где стояла, заявляет место (оболочка не отмотает его наверх кадром позже) и возвращает фокус на карточку, с которой
 * открыли вещь. Эффект раскладки идёт до первого кадра, а спрятанная Главная (`KeptPage`) при показе собирает эффекты заново, как при монтировании: каждый показ проверяет запись сам.
 * Выбор читается раньше прокрутки: `takeEditorReturnTop` стирает запись.
 */
export function useHomeReturn(rootRef) {
  useLayoutEffect(() => {
    const pick = peekEditorReturnPick(HOME_RETURN_ID);
    const top = takeEditorReturnTop(HOME_RETURN_ID);
    if (typeof top !== "number") return;
    document.querySelector(".desktop-main")?.scrollTo({ top, left: 0 });
    claimScroll(HOME_SECTION);
    /* Фокус — без прокрутки: место уже поставлено, и карточка встаёт под руку человеку с клавиатуры. */
    cardOf(rootRef.current, pick)?.focus({ preventScroll: true });
  }, [rootRef]);
}
