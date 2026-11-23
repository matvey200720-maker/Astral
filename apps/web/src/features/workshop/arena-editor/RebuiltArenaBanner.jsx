/*
 * Строка над панелью мастерской арены: в игре стоит арена, собранная старой версией (пересобранные модели зала Majestic), и
 * клиент Majestic её не принимает (`Invalid asset`, вылет). Два действия: «Пересобрать безопасно» — «Применить» работы новым
 * способом (модели зала со штатным строением, `apps/desktop/src/arena-shell-guard.js`), «Снять» — убрать арену из игры.
 * Откуда знаем — подготовка игры (`rebuilt-arena.js`).
 */
import Button from "../../../components/ui/Button.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { clearRebuiltArenas, useRebuiltArenas } from "./rebuilt-arena.js";

export default function RebuiltArenaBanner({ editor, busy = false }) {
  useTr();
  const works = useRebuiltArenas();
  if (!works.length) return null;
  const canRebuild = Boolean(editor.apply) && !busy && !editor.apply.disabled;
  return (
    <div className="arena-rebuilt" role="alert">
      <p className="arena-hint">
        {tr(
          "Эта арена собрана Astral старым способом: Majestic сейчас такие арены не принимает, и игра вылетает.",
        )}
      </p>
      <div className="arena-rebuilt-actions">
        <Button
          size="sm"
          variant="primary"
          disabled={!canRebuild}
          title={tr(
            "Собрать арену заново без пересборки моделей зала: цвета листов остаются, а чего так не выразить, то не применяется — об этом скажем словами",
          )}
          onClick={() => editor.install({ onDone: clearRebuiltArenas })}
        >
          {tr("Пересобрать безопасно")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          title={tr("Убрать арену Astral из игры: в игре будет арена сервера")}
          onClick={() => void editor.rollback({ onDone: clearRebuiltArenas })}
        >
          {tr("Снять арену")}
        </Button>
      </div>
    </div>
  );
}
