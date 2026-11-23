/*
 * Что делать с ответом установщика.
 *
 * Нативный установщик возвращает имя точки восстановления — полной копии
 * `update.rpf`, снятой до записи. Пока это имя не сохранено, дороги назад у
 * человека нет, и «Применить» превращается в дверь без ручки с обратной
 * стороны. Дальше идёт вторая обязанность, менее очевидная: прежняя версия
 * этой же работы должна уйти из стопки точек. Иначе удаление новой вернёт в
 * игру не чистый архив, а предыдущую версию — и каждое «Применить» будет
 * копить по два гигабайта.
 *
 * Обе обязанности лежали дважды — в окне мини-карты и в окне прицела, — двумя
 * похожими, но не одинаковыми копиями. Теперь одна.
 */

import {
  retireReplacedInstalls,
  SUCCESSOR_LOST_MESSAGE,
  successorLost,
} from "../../library/retire-previous.js";
import { readWorkshopProjects } from "../../../components/desktop/workshop/workshop-project.js";
import { recordProjectInstallation } from "./project-installs.js";
import { tr } from "../../../locales/ui.js";

const stamp = () => new Date().toISOString();

/**
 * @param {{
 *   projectId: string,
 *   kind: string,
 *   installed: object,
 *   gameRoot?: string,
 *   report?: Function,
 * }} input
 * @returns {Promise<object>} запись установки, какой она осталась в проекте
 */
export async function recordNativeInstall({
  projectId,
  kind,
  installed,
  gameRoot = "",
  report = null,
}) {
  const record = {
    ...installed,
    installId: installed.id,
    restorePointId: installed.id,
    kind,
    status: "active",
    installedAt: stamp(),
  };
  /* Прежние версии берутся из хранилища, а не из проекта в замыкании: за
     время установки список мог поменяться — например, работу сняли из
     библиотеки, пока она ставилась. */
  const project = readWorkshopProjects().find((item) => item.id === projectId);
  const previous = (project?.installations || []).filter(
    (item) =>
      item.kind === kind &&
      item.status === "active" &&
      item.installId !== record.installId,
  );
  recordProjectInstallation(projectId, record);
  if (!previous.length) return record;
  /* Уборка — второй проход по архиву, такой же долгий, как запись. Очередь
     показывает его отдельным шагом, иначе строка сорок секунд стояла бы на
     «Применение» без объяснения, чего ещё ждут. */
  report?.({ step: "retire" });
  /* Новая версия уже стоит — неудача замены ничего не ломает: прежняя точка
     просто остаётся лежать, и снять её можно будет из библиотеки. */
  const retired = await retireReplacedInstalls({
    gameRoot,
    successorId: record.restorePointId,
    previous,
  }).catch(() => null);
  if (!retired) return record;
  const moved = retired.remap[record.restorePointId];
  /* Бета 15.10 (kevake): новая версия не встала обратно после перемотки —
     окно молча стирало её запись, и «Применить» выглядело удавшимся, а в
     игре оставалось прежнее. Теперь — честная ошибка в очереди. */
  if (successorLost(retired, record.restorePointId)) throw new Error(tr(SUCCESSOR_LOST_MESSAGE));
  const current = moved
    ? {
        ...record,
        id: moved.restorePointId,
        installId: moved.restorePointId,
        restorePointId: moved.restorePointId,
        patch: moved.patch || record.patch,
        replacesInstallIds: [record.installId],
      }
    : record;
  const now = stamp();
  recordProjectInstallation(projectId, [
    ...previous
      .filter((item) => retired.gone.has(item.restorePointId))
      .map((item) => ({
        ...item,
        status: "rolled-back",
        rolledBackAt: now,
        replacedBy: current.installId,
      })),
    current,
  ]);
  return current;
}
