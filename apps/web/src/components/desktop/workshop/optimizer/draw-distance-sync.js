/*
 * «Дальность прорисовки» в игру — очередью мастерской (задача 7 ТЗ
 * 06.10.2026), как ступень «Ухудшения текстур»: ползунок и цвет только
 * выбирают, в игру уходит кнопкой «Установить» — одной работой очереди.
 *
 * Ключ работы один на вкладку: «Установить» ещё раз с другой дальностью,
 * пока работа ждёт очереди, заменяет ждущую — в игру уходит последняя.
 */

import { drawDistanceSignature, normalizeDrawDistance } from "@modovik/optimizer/draw-distance.js";
import { enqueueWorkshopInstall, workSignature } from "../../../../features/workshop/install-queue/index.js";
import { installDrawDistance, installedDrawDistance } from "../../../../features/workshop/install-queue/tasks/draw-distance.js";

export { installedDrawDistance };

/** Ключ работы вкладки в очереди. */
export const DRAW_DISTANCE_JOB_KEY = "astral.optimization.draw-distance.v1";

const isLive = (job) => job.status === "queued" || job.status === "running";

/** Работа вкладки, что ждёт или идёт: настройки — в `saved`. */
export function drawDistanceJob(snapshot) {
  return (snapshot?.jobs || []).find((job) => job.key === DRAW_DISTANCE_JOB_KEY && isLive(job)) || null;
}

/** Настройки, к которым придёт очередь: цель живой работы или то, что стоит. */
export function drawDistanceTarget(snapshot) {
  const job = drawDistanceJob(snapshot);
  return job?.saved ? normalizeDrawDistance(job.saved) : installedDrawDistance();
}

/** Отказ последней работы вкладки, пока его строка висит в очереди. */
export function drawDistanceFailure(snapshot) {
  return (snapshot?.jobs || []).find((job) => job.key === DRAW_DISTANCE_JOB_KEY && job.status === "failed")?.error || "";
}

/**
 * Поставить настройки: одна работа в очередь. Обещание — итог; `null`, если
 * в игру и так придут ровно эти.
 *
 * @returns {Promise<{ ok: boolean, message?: string, cancelled?: boolean }>|null}
 */
export function setDrawDistance({ settings, snapshot, title, editor, copy }) {
  const target = normalizeDrawDistance(settings);
  if (drawDistanceSignature(target) === drawDistanceSignature(drawDistanceTarget(snapshot))) return null;
  return new Promise((resolve) => {
    enqueueWorkshopInstall({
      key: DRAW_DISTANCE_JOB_KEY,
      signature: workSignature(target),
      title,
      editor,
      steps: [
        { id: "prepare", label: copy.stepPrepare, hint: copy.stepPrepareHint },
        { id: "compose", label: copy.stepCompose, hint: copy.stepComposeHint },
        { id: "commit", label: copy.stepCommit, hint: copy.stepCommitHint },
      ],
      operation: target.distance === null ? "remove" : "install",
      saved: target,
      run: async ({ report, saved }) => {
        await installDrawDistance({ settings: saved, report });
        return {};
      },
      onDone: () => resolve({ ok: true }),
      onFailed: (message) => resolve({ ok: false, message }),
      onCancelled: () => resolve({ ok: false, cancelled: true }),
    });
  });
}
