/*
 * «Применить» — одно нажатие на весь путь работы в игру.
 *
 * Порядок здесь и есть смысл этой кнопки:
 *
 *   1. правка сохраняется (у студии — в проект) до установки, а не после:
 *      установка может не удаться, а собранное человеком пропадать от этого
 *      не должно. В «Мои работы» «Применить» не пишет — туда кладёт только
 *      «Сохранить в мои работы»;
 *   2. работа встаёт в очередь применения и начинает ставиться сама;
 *   3. кнопка занята, пока работа ждёт или ставится, — второго нажатия
 *      просто нет.
 *
 * Ни окон, ни подтверждений, ни «Повторить установку» после успеха. Нажатие
 * не открывает и экран «В процессе»: работа улетает в иконку «Загрузки»
 * (features/downloads/work-flight.js), ход виден по ней, а чем кончилось —
 * скажет уведомление.
 *
 * СТАВИТСЯ ТО, ЧТО СОХРАНЕНО. Итог `save` едет в `run` третьим аргументом:
 * пока работа ждёт очереди, человек может править дальше, и в игру обязана
 * уехать та версия, которую он применил, а не та, что оказалась в редакторе
 * к началу записи.
 */

import {
  enqueueWorkshopInstall,
  workshopInstallPlace,
  workshopInstallStatusOf,
} from "./queue.js";
import { ownPacksOf, ragePackProblem, refreshRageMp, writeRagePackLog } from "./rage-pack.js";
import { tr } from "../../../locales/ui.js";
import { releaseRangeSelection } from "../../../utils/rangeSelection.js";
import { editorCoverKind } from "../covers/editor-covers.js";
import { deleteWorkCover, shootEditorFrame, slotCoverKey, writeWorkCover } from "../works/work-covers.js";

/*
 * Что сказать после нажатия.
 *
 * «Ставим в игру» — правда, только когда работа взялась сразу. Нажатие во
 * время чужой установки ставит её в ожидание, и обещать «ставим» значило бы
 * через минуту показать, что ничего не ставилось. Слова здесь отвечают на
 * вопрос, который человек задаёт, нажав: «и когда оно будет в игре?».
 */
function placeText(spec, before, place) {
  const name = `«${spec.title}»`;
  if (!place || place.status === "running")
    return spec.savedText || `${name} — ставим в игру`;
  if (before === "queued-other")
    return `Очередь обновлена: ${name} встанет в игру этой версией`;
  if (before === "running-other")
    return `${name} встанет в игру сразу после текущей установки — эта правка уже в очереди`;
  return place.ahead > 1
    ? `${name} в очереди: перед ней ещё ${place.ahead} — начнётся сама`
    : `${name} в очереди — встанет в игру сразу после текущей установки`;
}

/*
 * Работа легла поверх мода каталога на тех же файлах (задача 3 ТЗ
 * 10.10.2026): мод не снят, он ждёт под ней — об этом строка итога, иначе
 * человек решил бы, что мод пропал.
 */
function layeredOver(text, outcome) {
  const over = outcome?.result?.over || outcome?.over || [];
  if (!Array.isArray(over) || !over.length) return text;
  const tail = over.length === 1 ? tr("Мод каталога на тех же файлах остался под ней") : `Моды каталога на тех же файлах (${over.length}) остались под ней`;
  return `${String(text).replace(/\.$/, "")}. ${tail} — вернётся, когда работу снимут.`;
}

/*
 * Снимок работы (`works/work-covers.js`): снимается по нажатию, с кадра, на который человек смотрел, — ложится, когда работа встала в игру (не
 * встала — в игре прежняя, и картинка прежняя). `frame: false` — заявка не про открытый кадр (фоновое обновление, стволы из студии оружия).
 * `catalogCover` — работа из каталога: её обложка. Не из редактора и без обложки — снимка этой работы нет, прежняя картинка места уходит с ней.
 */
function beginApplyCover(spec) {
  if (spec.catalogCover) return Promise.resolve(spec.catalogCover);
  if (spec.frame === false || (!spec.coverProjectId && !spec.coverSlotId)) return null;
  return shootEditorFrame({ kind: editorCoverKind(spec.coverSlotId) || "" });
}

async function settleApplyCover(spec, shot) {
  const key = spec.coverProjectId ? `project:${spec.coverProjectId}` : slotCoverKey(spec.coverSlotId);
  if (!key || spec.frame === false) return;
  const url = await shot;
  if (url) await writeWorkCover(key, url);
  /* Снимок проекта — его собственный: другой работы под этим ключом не бывает. */
  else if (!spec.coverProjectId) await deleteWorkCover(key);
}

/**
 * @param {{
 *   key: string,
 *   signature?: string|null,
 *   title: string,
 *   editor: string,
 *   coverSlotId?: string,
 *   coverProjectId?: string,
 *   coverState?: string|null,
 *   coverImage?: string,
 *   catalogCover?: string,
 *   frame?: boolean,
 *   steps?: Array<{id: string, label: string, hint?: string}>,
 *   save?: () => Promise<unknown>|unknown,
 *   run: (context: {report: Function, saved: unknown}) => Promise<unknown>,
 *   notify?: (text: string, tone?: string) => void,
 *   savedText?: string,
 *   doneText?: (result: unknown) => string,
 * }} spec
 * @returns {Promise<boolean>} встала ли работа в очередь
 */
export async function applyWorkshopWork(spec) {
  const notify = spec.notify || (() => {});
  /* Свой пакет Astral и клиент RAGE MP (GTA 5 RP): найден ли он, спрашиваем до установки, к её концу ответ уже известен (`rage-pack.js`). */
  if (ownPacksOf(spec.key).length) void refreshRageMp();
  /* Снимок — первым делом: до уведомлений и полёта в «Загрузки», которые лягут на кадр. */
  const coverShot = beginApplyCover(spec);
  /* Невидимый диапазон в поле ползунка роняет процесс окна, пока кадр
     летит в «Загрузки» и строка установки перерисовывается (бета 14.10,
     `utils/rangeSelection.js`). Снимается и тогда, когда смятия не будет. */
  releaseRangeSelection();
  let saved = null;
  if (spec.save) {
    try {
      saved = await spec.save();
    } catch (error) {
      /* Не сохранилось — не ставим: в игру уехала бы одна работа, а в «Моих
         работах» осталась бы другая, и понять, какая из них в игре, стало бы
         нельзя. */
      notify(
        String(error?.message || error) || tr("Не удалось сохранить работу"),
        "error",
      );
      return false;
    }
  }
  const before = workshopInstallStatusOf(spec.key, spec.signature);
  const id = enqueueWorkshopInstall({
    key: spec.key,
    signature: spec.signature,
    title: spec.title,
    editor: spec.editor,
    coverSlotId: spec.coverSlotId,
    coverProjectId: spec.coverProjectId,
    coverState: spec.coverState,
    coverImage: spec.coverImage,
    steps: spec.steps,
    saved,
    run: spec.run,
    waitForGame: Boolean(spec.waitForGame),
    onDone: (result) => {
      void settleApplyCover(spec, coverShot);
      /* Слова про GTA 5 RP (`rpNote` в итоге работы: «видно / не видно», откат в старый пакет) — в то же уведомление о завершении: ряд «Загрузок» держит их 30 секунд, а уведомление остаётся человеку. */
      const rpWords = typeof result?.rpNote === "string" ? result.rpNote : "";
      const done = layeredOver(spec.doneText?.(result) || `«${spec.title}» установлена в GTA V`, result) + (rpWords ? ` ${rpWords}` : "");
      /* Релиз 1.0.2: слов «на GTA 5 RP это не видно» в уведомлении об установке нет (слово владельца: «все эти плашки поубирать»). В журнал строка пишется по-прежнему, только если RAGE MP найден и работа не шла контейнером и без `rpNote`: след для поддержки. */
      const rage = result?.viaContainer || rpWords ? null : ragePackProblem(spec.key);
      notify(done, "success");
      if (rage) writeRagePackLog(spec.title, rage.packs);
    },
    onFailed: (message) => notify(message, "error"),
  });
  notify(placeText(spec, before, workshopInstallPlace(id)), "success");
  return true;
}
