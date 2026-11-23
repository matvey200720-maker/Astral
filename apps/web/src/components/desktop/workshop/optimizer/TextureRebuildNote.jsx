import { useMemo } from "react";
import { ArrowCounterClockwise } from "../../../ui/icons.jsx";
import { OPTIMIZATION_RECORD_KEYS } from "@modovik/optimizer/layer-ids.js";
import { useWorkshopInstalls } from "../../../../features/workshop/install-queue/index.js";
import { useInstallRecords } from "../../../../features/workshop/useInstallRecord.js";
import { failureWords } from "../../../../utils/installFailure.js";
import { useTr } from "../../../../locales/ui.js";
import Button from "../../../ui/Button.jsx";
import { textureCopyFor } from "./texture-copy.js";
import { rebuildTextureLook, textureFailure, textureJob, textureModelsAreStale } from "./texture-sync.js";

/*
 * Плашка «Текстуры мира собраны прежней версией» (ТЗ 19.10.2026, задача 33).
 *
 * Модели «Стиля мира», «ЧБ-мира» и «Ухудшения текстур» до 19.10.2026 хост пересохранял целиком, и игра падала на
 * их столкновениях; теперь у модели меняются только текстуры (`MODEL_BUILD = 2`). Но в игре у людей остаётся
 * прежний пакет, пока они сами не нажмут «Установить» ещё раз. Плашка стоит над тремя вкладками одного пакета, пока
 * в записи установки пакет прежней сборки (`textureModelsAreStale`), и ставит то же, что стоит, заново — той же
 * работой очереди, что «Установить». Сама в игру не пишет: только по кнопке.
 */

/* Отказ словами очереди; «игра запущена» — словами раздела. */
function failureText(message, gameRunning) {
  const running = failureWords({ kind: "game-running" }, "ru").reason;
  const text = String(message || "");
  return text.startsWith(running) && gameRunning ? gameRunning : text;
}

export default function TextureRebuildNote({ locale = "ru", supported = true, editor, gameRunning = "", onNotice = null }) {
  const tr = useTr();
  const queue = useWorkshopInstalls();
  /* Запись установки — подписка: переустановка и снятие из «Библиотеки» видны сразу. */
  const records = useInstallRecords(OPTIMIZATION_RECORD_KEYS);
  const stale = useMemo(
    () => textureModelsAreStale(),
    // `records` — сигнал: запись установки читается из хранилища внутри.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, records],
  );
  const job = textureJob(queue);
  const failure = textureFailure(queue);
  if (!supported || !stale) return null;

  const rebuild = () => {
    const outcome = rebuildTextureLook({ snapshot: queue, title: tr("Пересборка текстур мира"), editor, copy: textureCopyFor(locale) });
    void outcome.then((result) => {
      if (result.cancelled) return;
      if (!result.ok) {
        onNotice?.(tr("Не удалось пересобрать текстуры мира: {0}").replace("{0}", failureText(result.message, gameRunning)), "error");
        return;
      }
      onNotice?.(tr("Текстуры мира пересобраны. Перезапустите игру, чтобы увидеть изменения."), "success");
    });
  };

  return (
    <section className="texture-rebuild-note" role="status" data-texture-rebuild aria-label={tr("Текстуры мира собраны прежней версией")}>
      <div className="texture-rebuild-text">
        <p className="texture-rebuild-title">{tr("Текстуры мира собраны прежней версией и могут ронять игру.")}</p>
        <p className="texture-rebuild-detail">
          {tr("Пакет в игре собран до исправления: модели карты с зашитыми текстурами из него вылетают на некоторых местах. «Пересобрать» соберёт его заново — в игру ничего не пишется, пока вы не нажмёте.")}
        </p>
        {failure && !job && (
          <p className="texture-rebuild-detail" data-failed="true">
            {tr("Не удалось пересобрать текстуры мира: {0}").replace("{0}", failureText(failure, gameRunning))}
          </p>
        )}
      </div>
      <Button size="sm" variant="primary" icon={<ArrowCounterClockwise />} disabled={Boolean(job)} onClick={rebuild}>
        {job ? (job.status === "queued" ? tr("В очереди…") : tr("Пересобираем…")) : tr("Пересобрать")}
      </Button>
    </section>
  );
}
