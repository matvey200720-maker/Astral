import { useEffect, useRef } from "react";
import { loadComponentPickLogic, takeComponentPickOutcome } from "../../../../features/catalog/bundles/component-pick.js";

/*
 * Возврат из каталога на страницу мода (владелец, 12.11.2026: «нажимаю на вариант — он сразу подставляется, и меня возвращает обратно. Без промежуточных шагов»).
 *
 * Страница мода при уходе в каталог размонтируется, поэтому выбор человека ждёт её в `component-pick.js`. Когда карточка встаёт заново, этот хук забирает исход ОДИН раз:
 *  • выбрана часть — берёт кандидата тем же разбором, что видел каталог (`candidateOfOutcome`), и ставит его тем же `swap`, что и окно замены: на карточке, смонтированной
 *    заново, выбор установленного редукса уходит в игру существующим путём очереди. Потом открывает окно «Компоненты» на записи этого компонента (`onReturn(слот)`);
 *  • «Отмена» — ничего не ставит, только возвращает прокрутку.
 * Прокрутку возвращает и сам исход: оболочка отматывает общий блок наверх кадром позже смены раздела, поэтому место ставится ещё раз после двух кадров.
 */

const restoreScroll = (top) => {
  if (typeof top !== "number") return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => document.querySelector(".desktop-main")?.scrollTo({ top, left: 0 }));
  });
};

/**
 * @param {{ view: object, choice: object, onReturn: (slot: string) => void }} input `choice` — `useComponentChoice` карточки; `onReturn` зовут, когда выбор применён.
 */
export function usePickReturn({ view, choice, onReturn }) {
  const latest = useRef(null);
  latest.current = { view, choice, onReturn };
  const taken = useRef(false);
  const group = choice.group;

  useEffect(() => {
    if (taken.current || !group) return;
    const outcome = takeComponentPickOutcome(group);
    if (!outcome) return;
    taken.current = true;
    restoreScroll(outcome.top);
    if (outcome.cancelled) return;
    const finish = (apply) => {
      const now = latest.current;
      if (apply) apply(now);
      now.onReturn(outcome.slot);
    };
    loadComponentPickLogic()
      .then((logic) =>
        finish((now) => {
          const candidate = logic.candidateOfOutcome(outcome, now.view.rails?.allMods || []);
          if (candidate && now.choice.list.some((one) => one.key === outcome.slot)) now.choice.swap(outcome.slot, candidate, document.body);
        }),
      )
      .catch(() => finish(null));
  }, [group]);
}
