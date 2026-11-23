import useStableHandler from "./useStableHandler.js";
import { historyKey, isTextEntry } from "../utils/hotkeys.js";
import { useEffect } from "react";

const EVENT = "keydown";

// Один общий слушатель Ctrl/Cmd+Z/Y на окне (Т-42, 29.09.2026): раскладку узнаёт
// historyKey, а поле для текста оставляет свою отмену себе. Обе проверки чистые,
// поэтому порядок их вызовов снаружи не виден.
const keyHandler = (history) => (event) => {
  const action = isTextEntry(event.target) ? null : historyKey(event);
  if (!action) return;
  event.preventDefault();
  history?.[action === "redo" ? "redo" : "undo"]?.();
};

const useHistoryKeys = (history, { enabled = true } = {}) => {
  // Обработчик стабилен, а читает свежую историю: слушатель не пересоздаётся.
  const onKey = useStableHandler(keyHandler(history));
  useEffect(() => {
    if (enabled) {
      window.addEventListener(EVENT, onKey);
      return () => window.removeEventListener(EVENT, onKey);
    }
  }, [enabled, onKey]);
};

export default useHistoryKeys;
