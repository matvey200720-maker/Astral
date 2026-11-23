/*
 * Очередь применения глазами React.
 *
 * Сам склад (`queue.js`) живёт рядом с окном, а не внутри страницы: редактор
 * мастерской выбрасывается при уходе в соседний раздел, а установка идёт
 * сорок пять секунд и обязана пережить этот уход. Здесь только подписка на
 * него — через `useSyncExternalStore`, чтобы снимок читался одинаково и при
 * первой отрисовке, и после каждой правки.
 */

import { createElement, useCallback, useMemo, useSyncExternalStore } from "react";

import ForeignBuildChoice, {
  isForeignBuildFailure,
} from "../../downloads/ForeignBuildChoice.jsx";
import {
  dismissWorkshopFailure,
  subscribeWorkshopInstalls,
  subscribeWorkshopInstallsStructure,
  workshopInstallFailureDetailOf,
  workshopInstallFailureOf,
  workshopInstallShareOf,
  workshopInstallStatusOf,
  workshopInstallsSnapshot,
  workshopInstallsStructure,
} from "./queue.js";

/**
 * Весь список: ждущие, текущая, неудавшиеся и чужая операция — без байтов
 * шага. Перерисовывает, когда меняется сама очередь (встала работа, сменился
 * шаг, итог), а не на каждый шаг копии архива (задача 1 ТЗ 08.10, вечер).
 * Проценты из этого снимка не читать — для них `useWorkshopInstallsLive`.
 */
export function useWorkshopInstalls() {
  return useSyncExternalStore(
    subscribeWorkshopInstallsStructure,
    workshopInstallsStructure,
    workshopInstallsStructure,
  );
}

/** То же с байтами шага — строкам «Загрузок», где видна полоса. */
export function useWorkshopInstallsLive() {
  return useSyncExternalStore(
    subscribeWorkshopInstalls,
    workshopInstallsSnapshot,
    workshopInstallsSnapshot,
  );
}

/**
 * Что сейчас с этой работой — для кнопки «Применить».
 *
 * Пока эта версия работы ждёт или ставится, кнопка занята и говорит об этом.
 * Именно это и убирает «повторную установку»: нажать второй раз нечем, а не
 * «нажатие молча ничего не делает». Другая версия той же работы — это уже
 * не повтор, а новая правка, и кнопка для неё свободна (см.
 * `workshopInstallStatusOf`).
 *
 * @param {string} key работа
 * @param {string|null} [signature] её версия в редакторе сейчас
 */
export function useWorkshopInstallStatus(key, signature = null) {
  const subscribe = useCallback(
    (listener) => subscribeWorkshopInstallsStructure(listener),
    [],
  );
  const read = useCallback(
    () => workshopInstallStatusOf(key, signature),
    [key, signature],
  );
  return useSyncExternalStore(subscribe, read, read);
}

const same = (text) => text;

/**
 * Кнопка «Применить» по состоянию работы в очереди.
 *
 * Надписи были переписаны в каждом редакторе своей копией, и когда у очереди
 * появилась вторая версия той же работы, копий стало бы пять разных. Здесь
 * одна.
 *
 *   `busy`    — надпись занятой кнопки: эта версия уже ждёт или ставится;
 *   `hint`    — подсказка свободной кнопки, когда в очереди другая версия:
 *               нажатие не отказ и не повтор, а следующая установка;
 *   `pending` — хоть какая-то версия работы в очереди. «Откатить» при этом
 *               недоступна: откатывать то, что сейчас перепишется, нельзя.
 *
 * @param {string} status из `workshopInstallStatusOf`
 * @param {(text: string) => string} [translate]
 */
export function workshopApplyButton(status, translate = same) {
  const t = translate;
  /* Одно слово на кнопке, пока работа идёт или ждёт своей очереди (ТЗ 08.10,
     вечер): «Идёт установка…». Что работа именно ждёт, говорит бегущая
     полоса без доли и подсказка (`queued`), а не второе слово. */
  return {
    pending: status !== "",
    busy:
      status === "running" || status === "queued"
        ? t("Идёт установка…")
        : "",
    queued: status === "queued",
    hint:
      status === "running-other"
        ? t(
            "Сейчас в игру ставится прежняя версия — эта встанет сразу после неё",
          )
        : status === "queued-other"
          ? t("В очереди ждёт прежняя версия — нажатие заменит её этой")
          : "",
  };
}

/**
 * Состояние кнопки «Применить» одной строкой: работа, её версия сейчас и,
 * если редактор переводит надписи, переводчик.
 *
 * `meter` — ход записи для заливки самой кнопки (`EditorActions`): откуда
 * читать долю и как сказать «готово». Подписывается на него кнопка, а не
 * редактор: проценты меняются сотню раз за установку, и перерисовывать на
 * каждый весь редактор со сценой ради одной кнопки незачем.
 */
export function useWorkshopApplyButton(
  key,
  signature = null,
  translate = same,
) {
  const status = useWorkshopInstallStatus(key, signature);
  const meter = useMemo(
    () => ({
      subscribe: subscribeWorkshopInstalls,
      read: () => workshopInstallShareOf(key, signature),
      busy: translate("Идёт установка…"),
      done: translate("Установлено"),
      detailsHint: translate("Подробности — в «Загрузках»"),
      dismissLabel: translate("Закрыть"),
      /* Отказ — на месте кнопки (задача 1): что случилось и «нажмите ещё
         раз»; закрыть — убрать и строку «Не удалось» из «Загрузок». */
      readFailure: () => workshopInstallFailureOf(key),
      readFailureDetail: () => workshopInstallFailureDetailOf(key),
      dismissFailure: () => dismissWorkshopFailure(key),
      /* Отказ-вопрос «оставить своё или заменить» («Выбери ниже…») отвечает
         прямо под кнопкой: кнопки выбора жили только в «Загрузках», а из
         редактора туда никто не вёл, и «Применить» давал тот же отказ снова. */
      failureChoice: ({ detail, language, onDecided }) =>
        isForeignBuildFailure(detail)
          ? createElement(ForeignBuildChoice, { language, onDecided })
          : null,
      queuedHint: translate(
        "В очереди: начнётся сама, как только закончится текущая установка",
      ),
      failedLabel: translate("Не удалось"),
    }),
    [key, signature, translate],
  );
  return useMemo(
    () => ({ status, ...workshopApplyButton(status, translate), meter }),
    [status, translate, meter],
  );
}
