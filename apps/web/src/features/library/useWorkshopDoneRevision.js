import { useSyncExternalStore } from "react";

import {
  subscribeWorkshopInstallsStructure,
  workshopInstallsStructure,
} from "../workshop/install-queue/queue.js";

/*
 * Библиотека узнаёт о конце установки работы мастерской (владелец, 18.11.2026: «когда скачается, оно в библиотеке должно отображаться», а не после перезахода на «Загрузки»).
 *
 * Работа мастерской стоит в игре записью в памяти окна: её пишет сама установка (`workshop-library.js`, `readWorkshopInstallUnits`), список `installed` оболочки при этом не меняется — он
 * про моды каталога и их части. Страница «Загрузки» открыта всё время, пока идёт установка, и читала записи один раз при входе, поэтому готовая работа не появлялась справа до нового захода.
 * Здесь — подпись «какие работы дошли до конца»: она меняется ровно тогда, когда очередь мастерской отмечает работу готовой (поставили или сняли), а не раньше и не по таймеру. Запись к этому
 * моменту уже лежит в памяти: очередь ставит «готово» после того, как работа вернулась из `run`. Отказ подпись не меняет — запись не появилась, читать нечего.
 */
const doneSignature = () =>
  workshopInstallsStructure()
    .jobs.filter((job) => job.status === "done")
    .map((job) => `${job.id}:${job.attempt}:${job.finishedAt}`)
    .join("|");

/** Подпись завершённых работ мастерской: зависимость для перечитывания записей установок. */
export function useWorkshopDoneRevision() {
  return useSyncExternalStore(
    subscribeWorkshopInstallsStructure,
    doneSignature,
    doneSignature,
  );
}
