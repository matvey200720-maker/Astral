import { useLayoutEffect } from "react";

/*
 * Правая колонка карточки «Пульт» листается внутри панели, а под ней стоит подвал («Что изменится в игре», серверы, «Установить»). Нижняя строка списка раньше уходила под подвал и
 * резалась пополам без зазора (сверка снимков 15.11.2026). Здесь листаемому полю в покое оставляется столько места, сколько занимают строки целиком, плюс зазор до подвала: остаток
 * места — пустой отступ под списком. Дальше пользователь листает как обычно. Всё помещается — отступа нет. Меряется по родителю, поэтому свой отступ размер не меняет.
 */

const GAP = 12;

export default function useWholeRows(ref, pick, deps) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver !== "function") return undefined;
    const fit = () => {
      box.style.marginBlockEnd = "";
      const room = box.clientHeight;
      if (box.scrollHeight <= room + 1) return;
      const origin = box.getBoundingClientRect().top - box.scrollTop;
      let cut = 0;
      for (const node of box.querySelectorAll(pick)) {
        const bottom = node.getBoundingClientRect().bottom - origin;
        if (bottom <= room - GAP && bottom > cut) cut = bottom;
      }
      if (cut > 0) box.style.marginBlockEnd = `${Math.round(room - cut)}px`;
    };
    fit();
    const watcher = new ResizeObserver(fit);
    if (box.parentElement) watcher.observe(box.parentElement);
    return () => {
      watcher.disconnect();
      box.style.marginBlockEnd = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт по списку и виду, не по каждому рендеру
  }, deps);
}
