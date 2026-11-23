/*
 * Ступень «Ухудшения текстур» в игру — очередью мастерской (задача 9,
 * 05.10.2026; с кнопкой «Установить» и на всю карту — задача 1 ТЗ
 * 05.10.2026, вечер).
 *
 * Ступень — свой пакет дополнения `astral_textures`
 * (`install-queue/tasks/textures.js`): ползунок только выбирает, в игру
 * ступень уходит кнопкой «Установить» — одна работа очереди.
 *
 * Ключ работы один на вкладку: человек нажал «Установить» ещё раз с другой
 * ступенью, пока работа ждёт своей очереди, — очередь заменяет ждущую
 * новой, и в игру уходит последняя ступень, а не каждая промежуточная.
 */

import { textureLevelAt } from "@modovik/optimizer/texture-levels.js";
import { TEXTURE_STYLES } from "@modovik/optimizer/texture-style-ids.js";
import {
  enqueueWorkshopInstall,
  workSignature,
} from "../../../../features/workshop/install-queue/index.js";
import {
  installTextureStep,
  installedGrayWorld,
  installedTextureStep,
  installedWorldDetail,
  installedWorldStyle,
  textureModelsAreStale,
  textureStepIsDated,
  textureStepIsLegacy,
} from "../../../../features/workshop/install-queue/tasks/textures.js";

export {
  installedGrayWorld,
  installedTextureStep,
  installedWorldDetail,
  installedWorldStyle,
  textureModelsAreStale,
  textureStepIsDated,
  textureStepIsLegacy,
};

/** Стоящую ступень есть чем дополнить: прежний слой набора или пакет без моделей карты. */
const textureStepNeedsUpdate = () => textureStepIsLegacy() || textureStepIsDated();

/** Ключ работы вкладки в очереди. */
export const TEXTURE_JOB_KEY = "astral.optimization.textures.v1";

const isLive = (job) => job.status === "queued" || job.status === "running";

/** Работа вкладки, что ждёт или идёт: `{ step }` в `saved`. */
export function textureJob(snapshot) {
  return (snapshot?.jobs || []).find((job) => job.key === TEXTURE_JOB_KEY && isLive(job)) || null;
}

/** Ступень, к которой придёт очередь: цель живой работы или то, что стоит. */
export function textureTargetStep(snapshot) {
  const job = textureJob(snapshot);
  return Number.isInteger(job?.saved?.step) ? job.saved.step : installedTextureStep();
}

/*
 * ЧБ-мир, к которому придёт очередь (ТЗ 17.10.2026, задача 10): ступень и ЧБ
 * — один пакет и одна работа вкладок; работа прежнего вида (без `gray`)
 * ЧБ не меняет.
 */
export function textureTargetGray(snapshot) {
  const job = textureJob(snapshot);
  return typeof job?.saved?.gray === "boolean" ? job.saved.gray : installedGrayWorld();
}

/*
 * Стиль мира, к которому придёт очередь (ТЗ 17.10.2026, задача 10): `null` —
 * без стиля. Стиль, ступень и ЧБ — один пакет и одна работа вкладок;
 * работа прежнего вида (без `style`) стиль не меняет.
 */
export function textureTargetStyle(snapshot) {
  const job = textureJob(snapshot);
  if (job && "style" in (job.saved || {})) return TEXTURE_STYLES.includes(job.saved.style) ? job.saved.style : null;
  return installedWorldStyle();
}

/*
 * Чёткость ЧБ-мира и стиля, к которой придёт очередь (ТЗ 17.10.2026, задача
 * 10): 128 или 256 px. Со ступенью «Ухудшения» она ни на что не влияет — её
 * предел главнее.
 */
export function textureTargetDetail(snapshot) {
  const job = textureJob(snapshot);
  if (job && "detail" in (job.saved || {})) return job.saved.detail === 256 ? 256 : 128;
  return installedWorldDetail();
}

/** Отказ последней работы вкладки, пока его строка висит в очереди. */
export function textureFailure(snapshot) {
  return (snapshot?.jobs || []).find((job) => job.key === TEXTURE_JOB_KEY && job.status === "failed")?.error || "";
}

/* Шаги работы: ступени из текстур игры (в первый раз — чтение всей карты),
   сборка пакета и подмена — те же фазы движка, что у карточек. */
function textureSteps(copy) {
  return [
    { id: "prepare", label: copy.stepPrepare, hint: copy.stepPrepareHint },
    { id: "compose", label: copy.stepCompose, hint: copy.stepComposeHint },
    { id: "commit", label: copy.stepCommit, hint: copy.stepCommitHint },
  ];
}

/**
 * Поставить ступень: одна работа в очередь. Обещание — итог работы; `null`,
 * если ступень уже та, к которой придёт очередь (и прежней установки,
 * которую надо перенести на всю карту или дополнить моделями, нет). ЧБ-мир
 * и стиль остаются какими придёт очередь.
 *
 * @returns {Promise<{ ok: boolean, message?: string, cancelled?: boolean }>|null}
 */
export function setTextureStep({ step, snapshot, title, editor, copy }) {
  const target = textureLevelAt(step).step;
  if (target === textureTargetStep(snapshot) && !(target && textureStepNeedsUpdate() && !textureJob(snapshot))) return null;
  return enqueueTextureLook({ step: target, gray: textureTargetGray(snapshot), style: textureTargetStyle(snapshot), detail: textureTargetDetail(snapshot), title, editor, copy });
}

/**
 * Пересобрать стоящий пакет текстур (ТЗ 19.10.2026): тот же вид — ступень, ЧБ-мир, стиль и чёткость, какими придёт
 * очередь, — той же работой, что «Установить»: хост собирает модели заново нынешней сборкой, пакет встаёт на место
 * прежнего. Без нажатия человека не вызывается.
 *
 * @returns {Promise<{ ok: boolean, message?: string, cancelled?: boolean }>}
 */
export function rebuildTextureLook({ snapshot, title, editor, copy }) {
  return enqueueTextureLook({
    step: textureTargetStep(snapshot),
    gray: textureTargetGray(snapshot),
    style: textureTargetStyle(snapshot),
    detail: textureTargetDetail(snapshot),
    title,
    editor,
    copy,
  });
}

/**
 * Включить или выключить ЧБ-мир (вкладка «ЧБ-мир»): та же работа очереди,
 * ступень и стиль — какими придёт очередь, чёткость — названная (`detail`)
 * или та, к которой придёт очередь. `null` — ЧБ уже такой.
 *
 * @returns {Promise<{ ok: boolean, message?: string, cancelled?: boolean }>|null}
 */
export function setGrayWorld({ on, snapshot, detail = textureTargetDetail(snapshot), title, editor, copy }) {
  if (Boolean(on) === textureTargetGray(snapshot) && detail === textureTargetDetail(snapshot)) return null;
  return enqueueTextureLook({ step: textureTargetStep(snapshot), gray: Boolean(on), style: textureTargetStyle(snapshot), detail, title, editor, copy });
}

/**
 * Поставить стиль мира (вкладка «Стиль мира»; `null` — снять): та же работа
 * очереди, ступень и ЧБ — какими придёт очередь. `null` — стиль уже тот.
 *
 * @returns {Promise<{ ok: boolean, message?: string, cancelled?: boolean }>|null}
 */
export function setWorldStyle({ style, snapshot, detail = textureTargetDetail(snapshot), title, editor, copy }) {
  const target = TEXTURE_STYLES.includes(style) ? style : null;
  if (target === textureTargetStyle(snapshot) && detail === textureTargetDetail(snapshot)) return null;
  return enqueueTextureLook({ step: textureTargetStep(snapshot), gray: textureTargetGray(snapshot), style: target, detail, title, editor, copy });
}

/**
 * Сменить чёткость стоящего ЧБ-мира или стиля (128 ↔ 256 px): та же работа
 * очереди, остальное — каким придёт очередь. `null` — чёткость уже та.
 *
 * @returns {Promise<{ ok: boolean, message?: string, cancelled?: boolean }>|null}
 */
export function setWorldDetail({ detail, snapshot, title, editor, copy }) {
  if (detail === textureTargetDetail(snapshot)) return null;
  return enqueueTextureLook({ step: textureTargetStep(snapshot), gray: textureTargetGray(snapshot), style: textureTargetStyle(snapshot), detail, title, editor, copy });
}

/* Работа вкладок текстур: ступень, ЧБ, стиль и чёткость — одним пакетом. */
function enqueueTextureLook({ step, gray, style = null, detail = 128, title, editor, copy }) {
  const target = textureLevelAt(step).step;
  const saved = { step: target, gray: Boolean(gray), style: TEXTURE_STYLES.includes(style) ? style : null, detail: detail === 256 ? 256 : 128 };
  return new Promise((resolve) => {
    enqueueWorkshopInstall({
      key: TEXTURE_JOB_KEY,
      signature: workSignature(saved),
      title,
      editor,
      steps: textureSteps(copy),
      operation: target || saved.gray || saved.style ? "install" : "remove",
      saved,
      run: async ({ report, saved: job }) => {
        await installTextureStep({
          step: job.step,
          gray: typeof job.gray === "boolean" ? job.gray : installedGrayWorld(),
          style: "style" in job ? job.style : installedWorldStyle(),
          detail: "detail" in job ? job.detail : installedWorldDetail(),
          report,
        });
        return {};
      },
      onDone: () => resolve({ ok: true }),
      onFailed: (message) => resolve({ ok: false, message }),
      onCancelled: () => resolve({ ok: false, cancelled: true }),
    });
  });
}
