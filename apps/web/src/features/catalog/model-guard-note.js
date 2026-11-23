import { tr } from "../../locales/ui.js";

/*
 * Итог установки части каталога или редукса: сторож моделей-пустышек (`apps/desktop/src/model-safety-guard.js`, 21.11.2026) не положил в игру модели без группы шейдеров — такие роняют обычную игру.
 * Главный процесс присылает в итоге `modelGuard = { count, names }`; одна короткая строка, только если что-то снято (имена — в журнале установки, не в окне). Модуль грузится по `import()`
 * из `DesktopShell.jsx` только когда `modelGuard` есть; слова — в языковых кусках словаря (`locales/ui-text/zone-model-guard-2111.js` и `fr/`), в главный кусок окна не входят.
 */
export function modelGuardNote(guard) {
  const count = Number(guard?.count);
  if (!Number.isFinite(count) || count < 1) return "";
  return tr(
    "Моделей-пустышек в сборке: {0}. Такие роняют обычную игру, поэтому их не положили, вещи остались штатными.",
  ).replace("{0}", String(Math.floor(count)));
}
