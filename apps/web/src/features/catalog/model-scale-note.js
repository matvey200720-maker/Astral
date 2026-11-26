/*
 * Итог установки ствола с размером модели, когда размер поменять не вышло (`apps/desktop/src/catalog-model-scale.js`, 26.11.2026): ствол или пак всё равно поставлен, и одна строка говорит,
 * что он в обычном размере, и почему. Главный процесс присылает `scaleSkipped = { plain, code, models }`: `plain` — весь пакет встал в 100 %, иначе только стволы `models` пака.
 * Модуль грузится по `import()` из `DesktopShell.jsx` только когда `scaleSkipped` есть; слова — в `locales/ui-text/zone-model-scale-2611.js` и `fr/`, в главный кусок окна не входят.
 */
import { tr } from "../../locales/ui.js";
import { rememberSize } from "../library/pack-card-model.js";

function plainWords(code) {
  if (code === "foreign")
    return tr(
      "Размер не поменять: в пакете есть файлы не этого ствола. Поставлено в обычном размере (100 %).",
    );
  if (code === "no-model")
    return tr(
      "Размер не поменять: в пакете нет модели ствола. Поставлено в обычном размере (100 %).",
    );
  if (code === "size")
    return tr(
      "Размер не поменять: в пакете слишком много файлов или они слишком тяжёлые. Поставлено в обычном размере (100 %).",
    );
  return tr(
    "Размер не поменять: модель ствола не перешивается. Поставлено в обычном размере (100 %).",
  );
}

/** Строка для уведомления об установке; `modId` — мод из очереди: карточка пака не должна помнить размер, которого в игре нет. */
export function modelScaleNote(skipped, modId, storage) {
  if (!skipped) return "";
  if (skipped.plain) {
    if (modId) rememberSize(modId, 100, storage);
    return plainWords(skipped.code);
  }
  const count = skipped.models?.length || 0;
  return count
    ? tr("Стволов в обычном размере: {0} — их модели не перешиваются.").replace(
        "{0}",
        String(count),
      )
    : "";
}
