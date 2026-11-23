import { useEffect, useMemo, useRef, useState } from "react";
import { installedWorkItems } from "./my-mods.js";
import { mergeWorkCards } from "./work-cards.js";

/** Работы, что можно унести в сборку, — карточками библиотеки, и порядок установок: у какой работы карточки лицо (`work-cards.js`). */
export function useInstalledWorkCards(workItems, installedWorks) {
  const installOrder = useMemo(() => workItems.map((item) => item.name), [workItems]);
  const installedWorkCards = useMemo(() => mergeWorkCards(installedWorks, { order: installOrder }), [installedWorks, installOrder]);
  return { installOrder, installedWorkCards };
}

function readSafely() {
  try {
    return installedWorkItems();
  } catch {
    /* Битая запись одного редактора не должна ронять сборки и полку. */
    return [];
  }
}

/**
 * Работы мастерской, что стоят в игре, — для экрана (`my-mods.js`).
 *
 * Записи установок пишут сами редакторы в хранилище окна, подписки на них
 * нет; поэтому список перечитывается, когда меняется то, что их меняет:
 * профиль установки (`installed` после любой записи в игру), открытие окна
 * новой сборки, возвращение в окно.
 *
 * @param {...unknown} triggers что перечитывать по смене
 */
export function useInstalledWorkItems(...triggers) {
  const [items, setItems] = useState(readSafely);
  /* Возврат в окно — частое событие, а записи установок меняются редко: тот же список не перерисовывает полку. */
  const shown = useRef(null);
  shown.current = items;
  useEffect(() => {
    setItems(readSafely());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, triggers);
  useEffect(() => {
    const refresh = () => {
      const next = readSafely();
      if (JSON.stringify(next) !== JSON.stringify(shown.current)) setItems(next);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return items;
}
