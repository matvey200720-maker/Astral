import { useLayoutEffect, useId, useContext, createContext } from "react";

const LINE_BREAK = "\n";

// Значение — { register, unregister } оболочки; null, если у колонки нет имени панели.
export const PanelHelpContext = createContext(null);

// Оболочка берёт подсказку, только если она есть и не пуста.
const taken = (panel, text) => Boolean(panel) && text !== "";

// Запись подсказки раздела в оболочку; возвращает снятие записи (или undefined, если писать нечего).
function announce(panel, id, text) {
  if (!taken(panel, text)) return undefined;
  panel.register(id, text.split(LINE_BREAK));
  return () => {
    panel.unregister(id);
  };
}

/**
 * Отдаёт абзацы подсказки раздела оболочке. Возвращает true, если подсказку взяла оболочка
 * и раздел свой «?» не рисует. Запись идёт в слое до отрисовки, чтобы «?» шапки сразу
 * нёс слова раздела.
 */
export function usePanelHelp(paragraphs) {
  const [panel, id] = [useContext(PanelHelpContext), useId()];
  const text = paragraphs.join(LINE_BREAK);

  useLayoutEffect(() => announce(panel, id, text), [panel, id, text]);

  return taken(panel, text);
}
