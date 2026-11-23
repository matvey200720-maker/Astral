/*
 * «Весь кадр серым» в игру (задача 35 (в), 19.10.2026): насыщенность картинки самой игры — ноль во все часы и во
 * всех типах погоды (`look.weather.grayFrame`, `@modovik/timecycle`). Серыми становятся и люди, и машины, и небо
 * с водой, то есть то, что не берёт «ЧБ-мир» текстурами. Не проверено в игре: подпись выключателя говорит об этом.
 *
 * Ставится тем же путём, что работа «Таймциклы»: проект неба, `applyTimecycleCustomization`, запись установки с
 * ключом неба (`astral.timecycle.install.v1`) и общее место в очереди — серый кадр и «Применить» неба не гонятся
 * друг за другом. Серый кадр — поле проекта неба, а не отдельный мод, поэтому:
 *
 *  • небо, которое человек уже поставил из «Таймциклов», остаётся: проект берётся из записи установки (не из
 *    черновика редактора — несохранённые правки в игру не уедут), и в нём меняется одно поле;
 *  • неба нет — ставится проект из одного серого кадра, блики объектива в нём «как в игре»;
 *  • выключили, и ничего больше в проекте нет — установка снимается откатом (чисто, как «Как было» в редакторе);
 *    есть небо человека — оно ставится заново без серого кадра;
 *  • «Как было» в самом редакторе снимает весь проект, серый кадр тоже: выключатель читает запись, а не память.
 *
 * Черновик редактора (`astral.timecycle.project.v1`) получает то же поле: иначе первое «Применить» неба из
 * редактора молча сняло бы серый кадр.
 */

import { applyTimecycleCustomization, skyInstallerCurrent } from "../../../../api.js";
import { tr } from "../../../../locales/ui.js";
import { readInstallRecord, rollbackInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";
import { REPLACING_INSTALL_STEPS, enqueueWorkshopInstall } from "../queue.js";
import { workSignature } from "../signature.js";
import { installEditorWork } from "./editor-work.js";

/** Ключ записи и работы неба: серый кадр делит его с «Таймциклами». */
export const GRAY_FRAME_INSTALL_KEY = "astral.timecycle.install.v1";

/** Черновик редактора неба. */
const SKY_DRAFT_KEY = "astral.timecycle.project.v1";

const isLive = (job) => job.status === "queued" || job.status === "running";
const isGrayFrameJob = (job) => job.key === GRAY_FRAME_INSTALL_KEY && typeof job.saved?.grayFrame === "boolean";

/** Стоит ли серый кадр: он есть в проекте, который лежит в записи установки неба. */
export function installedGrayFrame() {
  const record = readInstallRecord(GRAY_FRAME_INSTALL_KEY);
  if (!record?.installedState) return false;
  try {
    const project = typeof record.installedState === "string" ? JSON.parse(record.installedState) : record.installedState;
    return project?.look?.weather?.grayFrame === true;
  } catch {
    return false;
  }
}

/** Работа серого кадра, что ждёт или идёт. */
export function grayFrameJob(snapshot) {
  return (snapshot?.jobs || []).find((job) => isGrayFrameJob(job) && isLive(job)) || null;
}

/** Серый кадр, к которому придёт очередь: цель живой работы или то, что стоит. */
export function grayFrameTarget(snapshot) {
  const job = grayFrameJob(snapshot);
  return job ? job.saved.grayFrame : installedGrayFrame();
}

/** Отказ последней работы серого кадра, пока его строка висит в очереди. */
export function grayFrameFailure(snapshot) {
  return (snapshot?.jobs || []).find((job) => isGrayFrameJob(job) && job.status === "failed")?.error || "";
}

/** Проект неба из записи установки: `null` — неба в игре нет; отказ — запись из прежней версии. */
function installedProject(sky) {
  const record = readInstallRecord(GRAY_FRAME_INSTALL_KEY);
  if (!record) return null;
  const state = record.installedState;
  if (!state) throw new Error(unreadableSky());
  try {
    return sky.parseProject(state);
  } catch {
    throw new Error(unreadableSky());
  }
}

const unreadableSky = () =>
  tr("Небо в игре поставлено прежней версией Astral, и серый кадр сам его не заменит. Поставьте небо заново в «Таймциклах» — серый кадр встанет вместе с ним.");

/* Черновик редактора получает то же поле; пустой после снятия — стирается, и редактор открывается с умолчаниями. */
function syncDraft(sky, project, on) {
  try {
    const stored = window.localStorage.getItem(SKY_DRAFT_KEY);
    if (!stored) {
      if (on) window.localStorage.setItem(SKY_DRAFT_KEY, sky.serializeProject(project));
      return;
    }
    const next = sky.withGrayFrame(sky.parseProject(stored), on);
    if (sky.projectIsEmpty(next)) window.localStorage.removeItem(SKY_DRAFT_KEY);
    else window.localStorage.setItem(SKY_DRAFT_KEY, sky.serializeProject(next));
  } catch {
    /* приватный режим или чужой черновик — серый кадр в игре от этого не зависит */
  }
}

/** Сам путь в игру: читает запись установки в момент работы, а не при нажатии. */
async function runGrayFrame({ on, report }) {
  const sky = await import("@modovik/timecycle");
  const base = installedProject(sky) || sky.createGrayFrameProject(tr("Серый кадр"));
  const project = sky.withGrayFrame(base, on);
  if (!on && sky.projectIsEmpty(project)) {
    /* Кроме серого кадра в проекте ничего нет: игра возвращается к своему небу откатом. */
    await rollbackInstallRecord(GRAY_FRAME_INSTALL_KEY);
    syncDraft(sky, project, false);
    return {};
  }
  /* Радугу и готовые облака собирает свежий установщик: устаревший поставил бы их не так (как у «Применить» неба). */
  if ((project.look.weather.rainbow || project.look.clouds.template) && !skyInstallerCurrent())
    throw new Error(tr("Astral обновился — перезапустите его, чтобы поставить радугу и готовые облака"));
  const gameRoot = (await locateLegacyTarget()).path;
  await installEditorWork({
    editor: "timecycle",
    storageKey: GRAY_FRAME_INSTALL_KEY,
    state: sky.serializeProject(project),
    report,
    apply: () => applyTimecycleCustomization({ project, gameRoot }),
    details: (result) => ({ files: result?.files?.length || 0 }),
  });
  syncDraft(sky, project, on);
  return {};
}

/**
 * Включить или выключить серый кадр: одна работа очереди с общим ключом неба. `null` — кадр уже такой, к какому
 * придёт очередь. Обещание — итог работы.
 *
 * @returns {Promise<{ ok: boolean, message?: string, cancelled?: boolean }>|null}
 */
export function setGrayFrameInstall({ on, snapshot, title, editor }) {
  const grayFrame = Boolean(on);
  if (grayFrame === grayFrameTarget(snapshot)) return null;
  return new Promise((resolve) => {
    enqueueWorkshopInstall({
      key: GRAY_FRAME_INSTALL_KEY,
      signature: workSignature({ grayFrame }),
      title,
      editor,
      steps: REPLACING_INSTALL_STEPS,
      operation: grayFrame ? "install" : "remove",
      saved: { grayFrame },
      run: ({ report, saved }) => runGrayFrame({ on: saved?.grayFrame === true, report }),
      onDone: () => resolve({ ok: true }),
      onFailed: (message) => resolve({ ok: false, message }),
      onCancelled: () => resolve({ ok: false, cancelled: true }),
    });
  });
}
