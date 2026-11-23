/*
 * Раздел «ReShade» (задача 4 ТЗ 04.10.2026; с ТЗ 05.10, задача 15, — только
 * DLSS 5; с ТЗ 17.10, задача 8, — две вкладки: пресеты и DLSS 5; с ТЗ 23.10,
 * п. G, — одна страница без вкладок).
 *
 * Сверху — заголовок «ReShade · DLSS 5» с кратким описанием (ТЗ 24.10.2026, ночь, п. 2: вернулся наверх). Под ним слева — кадры
 * из игры с лентой миниатюр (вровень с колонкой справа и во всю её высоту), ниже «как с ним играть» и готовые пресеты; справа — колонка «Состав»: ReShade (установить и удалить), клавиша
 * меню в игре, DLSS 5 (установить и числа нейросети), «Ваш ПК». Страница
 * говорит «во все найденные проекты» и не перечисляет их по именам: ReShade
 * идёт на все проекты. Всё читает и пишет один владелец состояния
 * (`use-reshade.js`): что стоит, берётся из ответа главного процесса, а не из
 * памяти окна.
 *
 * Что и куда кладёт установка — `reshade-installer.js` в главном процессе,
 * тексты ReShade.ini — `@modovik/optimizer/reshade.js`. Слова страницы — в
 * `reshade-page-copy.js`, пресетов — `reshade-presets-copy.js`, кадров и чисел
 * DLSS 5 — `reshade-copy.js`.
 */

import { usePageFrame } from "../../components/desktop/use-page-frame.js";
import { tr, useUiLanguage } from "../../locales/ui.js";
import "./reshade-cinema.css";
import ReshadeCompose from "./ReshadeCompose.jsx";
import ReshadeGallery from "./ReshadeGallery.jsx";
import ReshadeFacts from "./ReshadeFacts.jsx";
import ReshadeHowTo from "./ReshadeHowTo.jsx";
import ReshadePresets from "./ReshadePresets.jsx";
import { reshadePageCopyFor } from "./reshade-page-copy.js";
import { reshadePresetsCopyFor } from "./reshade-presets-copy.js";
import { useReshade } from "./use-reshade.js";

/* Имя страницы — два названия, у всех языков одинаковое: на рейке она «ReShade и DLSS 5», над кадром — крупное «DLSS 5». */
const PAGE_TITLE = "ReShade · DLSS 5";

export default function ReshadePage({ onNotice }) {
  usePageFrame(".desktop-main", ".desktop-content", true);
  const language = useUiLanguage();
  const copy = reshadePageCopyFor(language);
  const presetCopy = reshadePresetsCopyFor(language);
  const ctrl = useReshade(onNotice);
  const { installed, presetOn, dlssOn, menuKey } = ctrl;

  /* Что стоит, словами: «Пресет «Кино» · DLSS 5»; ReShade сам по себе — «ReShade установлен». */
  const stateText = installed
    ? [
        presetOn
          ? copy.pillPreset(presetCopy.presets[presetOn]?.name ?? "")
          : "",
        dlssOn ? copy.pillDlss : "",
      ]
        .filter(Boolean)
        .join(" · ") || copy.pillInstalled
    : copy.stateOff;

  const state = { on: installed, text: stateText };

  return (
    <section className="reshade-page is-cinema" aria-label={presetCopy.heading}>
      {/* Дизайн 15.11.2026, «Кино»: кадр «до/после» во всю ширину с крупным «DLSS 5» и лентой крупных планов; под ним три карточки
          («Состояние», «Что нужно», «В игре и числа»), ниже «как играть» и пресеты. */}
      <header className="reshade-cinema-hero">
        <ReshadeGallery state={state} />
        <div className="reshade-cinema-title">
          <span>{tr("Нейросеть NVIDIA в GTA V")}</span>
          <h1 aria-label={PAGE_TITLE}>DLSS 5</h1>
          <p>{copy.description}</p>
        </div>
      </header>
      <ReshadeCompose ctrl={ctrl} onNotice={onNotice} state={state} />
      <div className="reshade-cinema-below">
        <ReshadeHowTo menuKey={menuKey} />
        <ReshadePresets ctrl={ctrl} onNotice={onNotice} />
        <ReshadeFacts />
      </div>
    </section>
  );
}
