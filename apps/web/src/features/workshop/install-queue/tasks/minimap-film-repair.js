/*
 * Починка фильма мини-карты: штатный файл, потом работа человека тем же `installMinimap`, что у «Применить».
 *
 * Почему две записи и что в главном процессе — `apps/desktop/src/minimap-film-repair.js`. Окно здесь потому, что сама работа
 * и её картинки живут только в окне. Запись идёт очередью мастерской: две установки разом главный процесс не пустит, а человек
 * видит в «Загрузках», что архив игры сейчас пишется. Вопросов нет: итог — одна короткая строка.
 */

import { applyMinimapFilmRepair, reportMinimapFilm } from "../../../../api.js";
import { readWorkshopProjects } from "../../../../components/desktop/workshop/workshop-project.js";
import { tr } from "../../../../locales/ui.js";
import {
  REPLACING_INSTALL_STEPS,
  dismissWorkshopFailure,
  enqueueWorkshopInstall,
} from "../queue.js";
import { MINIMAP_INSTALL_KIND, installMinimap } from "./minimap.js";

const JOB_KEY = "minimap-film-repair";

const samePlace = (left, right) =>
  String(left || "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() ===
  String(right || "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();

/**
 * Работа, которая стоит в этой игре: у проекта есть действующая запись мини-карты. Снятая работа в игру не возвращается, а из
 * нескольких действующих в игре лежит поставленная последней.
 */
export function minimapWorkInGame(projects, gameRoot) {
  let best = null;
  for (const project of Array.isArray(projects) ? projects : []) {
    for (const record of project?.installations || []) {
      if (record?.kind !== MINIMAP_INSTALL_KIND || record.status !== "active") continue;
      if (record.gameRoot && !samePlace(record.gameRoot, gameRoot)) continue;
      const at = Date.parse(record.installedAt || "") || 0;
      if (!best || at >= best.at) best = { project, at };
    }
  }
  return best?.project || null;
}

/** Штатный файл, затем работа. Не вышла работа — фильм всё равно исправен, и об этом честный итог, а не сбой починки. */
export async function repairMinimapFilm({ gameRoot, report }) {
  const healed = await applyMinimapFilmRepair({ gameRoot });
  if (healed?.deferred) return { deferred: true };
  const project = minimapWorkInGame(readWorkshopProjects(), gameRoot);
  if (!project) return { healed, rebuilt: false };
  try {
    await installMinimap({
      project: { ...project, gamePath: gameRoot },
      configuration: project.modules?.minimap || {},
      report,
      /* Запись сверки честно называет, что запустило установку: не «Применить», а автопересборка после починки. */
      trigger: "repair",
    });
    return { healed, rebuilt: true, projectId: project.id };
  } catch (error) {
    return { healed, rebuilt: false, projectId: project.id, rebuildError: String(error?.message || error) };
  }
}

function resultText(result) {
  if (result.rebuilt) return tr("Astral починил мини-карту: карта паузы снова на месте — перезапустите GTA V");
  if (result.projectId)
    return tr("Карта паузы снова на месте, но мини-карта стала штатной: примените свою заново");
  return tr("Astral вернул штатный файл мини-карты: карта паузы снова на месте — перезапустите GTA V");
}

function resultDetail(result) {
  if (result.rebuilt) return `пересобрана работа ${result.projectId}`;
  if (result.projectId) return `штатный файл на месте, работа ${result.projectId} не встала: ${result.rebuildError}`;
  return "работы нет, штатный файл на месте";
}

export function enqueueMinimapFilmRepair({ gameRoot, notify }) {
  const editor = tr("Мини-карта");
  return enqueueWorkshopInstall({
    key: JOB_KEY,
    title: editor,
    editor,
    coverSlotId: "minimap",
    steps: REPLACING_INSTALL_STEPS,
    run: ({ report }) => repairMinimapFilm({ gameRoot, report }),
    onDone: (result) => {
      if (result?.deferred) return;
      notify?.(resultText(result), result.rebuilt || !result.projectId ? "success" : "info");
      reportMinimapFilm({ gameRoot, outcome: "done", detail: resultDetail(result) }).catch(() => {});
    },
    onFailed: (message) => {
      notify?.(tr("Не удалось починить мини-карту: карта паузы может съезжать. Примените мини-карту заново"), "error");
      reportMinimapFilm({ gameRoot, outcome: "failed", detail: message }).catch(() => {});
      /* Строка с «Повторить» здесь ни к чему: человек этой установки не просил, следующий запуск попробует сам. */
      dismissWorkshopFailure(JOB_KEY);
    },
  });
}
