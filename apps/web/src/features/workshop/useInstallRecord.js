/*
 * Память об установке и дорога назад.
 *
 * Любая правка мастерской, уехавшая в игру через `install-rpf-patch`, оставляет
 * за собой точку восстановления: нативный установщик снимает полный backup
 * `update.rpf` до записи и возвращает её `id`. Пока этот `id` не сохранён,
 * дороги назад у человека нет — из приложения во всяком случае, — и «применить»
 * превращается в дверь без ручки с обратной стороны.
 *
 * Именно так и было у неба, эффектов попадания и килл-эффекта: патч уезжал,
 * `id` терялся в возвращённом объекте, а откатывать предлагалось руками через
 * OpenIV. У воды, растительности и большой карты откат был — тремя копиями
 * одного и того же кода.
 *
 * ЗАЧЕМ ХРАНИЛИЩЕ БРАУЗЕРА, А НЕ СОСТОЯНИЕ
 *
 * «Откатить» обязана пережить закрытие редактора: человек ставит небо, идёт
 * смотреть его в игре, возвращается — и именно тогда решает вернуть как было.
 * Кнопка, живущая до первого закрытия окна, — кнопка на один вечер.
 *
 * ПОЧЕМУ ЭТО НЕ ЕДИНСТВЕННАЯ ПАМЯТЬ ОБ УСТАНОВКЕ В МАСТЕРСКОЙ
 *
 * У прицела, мини-карты и большой карты запись установки уезжает в ПРОЕКТ
 * мастерской (`onInstallationChange`): у них есть проект, он ходит вместе с
 * работой человека, и карточка работы должна знать, установлена она или нет.
 * У неба, эффектов, килл-эффекта, воды и растительности проекта в каталоге
 * нет — их запись живёт здесь и никуда больше не ходит.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readParkedInstalls } from "../library/parked-installs.js";
import {
  retireReplacedInstalls,
  rollBackInstall,
  SUCCESSOR_LOST_MESSAGE,
  successorLost,
} from "../library/retire-previous.js";
import { tr } from "../../locales/ui.js";

/**
 * Запись установки как она лежит сейчас — без React. Очередь читает её в
 * момент записи в игру: работа, вставшая за другой версией, обязана
 * опираться на то, что оставила та, а не на то, что было при нажатии.
 */
export function readInstallRecord(storageKey) {
  return readRecord(storageKey);
}

/**
 * Снять установку по записи без React — для тех, кто снимает работы не из
 * редактора (сборка). То же, что «Снять из игры» в редакторе: откат по
 * записи и забытая запись. `false` — снимать нечего.
 */
export async function rollbackInstallRecord(storageKey) {
  const record = readRecord(storageKey);
  if (!record) return false;
  await rollBackInstall({
    install: record,
    ...(typeof record.gameRoot === "string" && record.gameRoot
      ? { gameRoot: record.gameRoot }
      : {}),
  });
  writeRecord(storageKey, null);
  return true;
}

/**
 * Снять установку по записи без React, как кнопка «Снять» редактора: откат по записи, забытая запись и пересборка того, что стояло поверх снятой
 * работы (ступень текстур, растительность, места). Для сторожа запуска (`arena-editor/rebuilt-arena.js`). `false` — снимать нечего.
 */
export async function rollbackInstallRecordAndRefresh(storageKey) {
  const record = readRecord(storageKey);
  if (!record) return false;
  const removed = await rollBackInstall({
    install: record,
    ...(typeof record.gameRoot === "string" && record.gameRoot ? { gameRoot: record.gameRoot } : {}),
  });
  writeRecord(storageKey, null);
  const { refreshAfterRemoval } = await import("./install-queue/tasks/recolor.js");
  await refreshAfterRemoval(removed);
  return true;
}

/*
 * Запись без точки восстановления бесполезна: откатывать нечем. Исключение —
 * мод слоя Astral рядом с точкой (`layerModId`): у фонарей модели едут
 * пакетом движка, а файлы update.rpf — патчем, и работа, которой патч не
 * понадобился, стоит в игре одним модом. Снимается и он.
 */
const hasRestorePoint = (record) =>
  typeof record?.restorePointId === "string" && Boolean(record.restorePointId);
const hasLayerMod = (record) =>
  typeof record?.layerModId === "string" && Boolean(record.layerModId);

/*
 * Работа, снятая проверкой файлов игры (задача 2 ТЗ 10.10.2026), — не в
 * игре: редактор и очередь не видят её стоящей, а запись ждёт «Установить
 * снова» (`parked-installs.js`).
 */
function parkedRecord(record) {
  const parked = readParkedInstalls(window.localStorage);
  return (
    (hasLayerMod(record) && parked.modIds.has(record.layerModId)) ||
    (typeof record?.modId === "string" && parked.modIds.has(record.modId)) ||
    (hasRestorePoint(record) && parked.points.has(record.restorePointId))
  );
}

function readRecord(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!(hasRestorePoint(record) || hasLayerMod(record))) return null;
    return parkedRecord(record) ? null : record;
  } catch {
    return null;
  }
}

/*
 * Кто узнаёт о записи, кроме того, кто её сделал.
 *
 * Установку теперь ведёт очередь применения, а не сам редактор: она пишет
 * запись, когда работа встала в игру, и делает это из своего замыкания —
 * редактор к этому моменту может быть уже закрыт. Открытый редактор узнаёт
 * о записи отсюда: иначе «Откатить» у него так и не появилась бы до
 * следующего открытия.
 */
const listeners = new Set();

/**
 * Мод слоя записи сменил id без участия окна (перенос мест в пакет мест при
 * подготовке игры, фикс 1 ТЗ 06.10.2026): та же работа, тот же облик, новый
 * пакет. Запись переписывается, только если она ещё смотрит на прежний id.
 */
export function renameInstallRecordMod(storageKey, from, to) {
  const record = readRecord(storageKey);
  if (!record || record.layerModId !== from || !to || from === to) return false;
  writeRecord(storageKey, { ...record, layerModId: to });
  return true;
}

function writeRecord(storageKey, record) {
  try {
    if (record) window.localStorage.setItem(storageKey, JSON.stringify(record));
    else window.localStorage.removeItem(storageKey);
  } catch {
    /* приватный режим не мешает установке — теряется только память об откате */
  }
  for (const listener of listeners) listener(storageKey);
}

function subscribeInstallRecords(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Запомнить установку без React — из очереди применения.
 *
 * Возвращает запись или `null`, если установщик не дал ни имени точки, ни
 * мода слоя (`installed.layerModId`): пустая запись зажгла бы «Откатить»,
 * которая ответила бы ошибкой.
 *
 * Уборка прежней версии здесь ждётся, а не запускается вдогонку: это второй
 * проход по архиву, такой же долгий, как запись, и очередь показывает его
 * отдельным шагом. `report` — от неё же.
 */
export async function rememberInstallRecord(
  storageKey,
  installed,
  extra = {},
  { report = null } = {},
) {
  const restorePointId =
    typeof installed?.id === "string" ? installed.id : "";
  const layerModId =
    typeof installed?.layerModId === "string" ? installed.layerModId : "";
  if (!restorePointId && !layerModId) return null;
  const next = {
    ...(restorePointId ? { restorePointId } : {}),
    ...(layerModId ? { layerModId } : {}),
    /* Папка патча — второе имя установки. Библиотека, убирая работу из
       середины стопки, ставит лежавшие сверху заново под новыми именами
       точек, и по патчу запись находит свою точку, даже если ответ с новым
       именем до окна не дошёл. */
    ...(typeof installed?.patch === "string" && installed.patch
      ? { patch: installed.patch }
      : {}),
    installedAt: new Date().toISOString(),
    ...extra,
  };
  const previous = readRecord(storageKey);
  writeRecord(storageKey, next);
  if (
    !restorePointId ||
    !previous?.restorePointId ||
    previous.restorePointId === restorePointId
  )
    return next;
  /* Прежняя версия уходит из стопки точек: иначе удаление новой вернуло бы в
     игру не чистый файл, а прежнюю версию. Новая уже стоит — неудача здесь
     ничего не ломает, прежняя просто остаётся. */
  report?.({ step: "retire" });
  /* Папка игры — из ответа установки: у точек эффектов и наборов файла
     точки нативного хоста нет, и без неё главный процесс не знал, из какой
     GTA V удалять (прежняя версия оставалась в стопке). */
  const gameRoot = String(installed?.gameRoot || extra?.gameRoot || "");
  const retired = await retireReplacedInstalls({
    ...(gameRoot ? { gameRoot } : {}),
    successorId: restorePointId,
    previous: [previous],
  }).catch(() => null);
  /* Новая версия не встала обратно (бета 15.10, kevake: трассеры остались
     штатными, а галочка пропала молча) — ошибка в очереди, а не «готово». */
  if (successorLost(retired, restorePointId)) throw new Error(tr(SUCCESSOR_LOST_MESSAGE));
  return readRecord(storageKey) || next;
}

/**
 * Забыть установку без React: в игре от работы ничего не осталось (новая
 * версия вернула игру к её виду и сняла прежнюю). Открытый редактор узнаёт
 * об этом так же, как о новой записи.
 */
export function forgetInstallRecord(storageKey) {
  writeRecord(storageKey, null);
}

/**
 * Записи нескольких ключей разом — для счётчика над карточками (слои
 * оптимизации). `storageKeys` — постоянный массив: новый массив на каждый
 * рендер переподписывал бы слушателя без конца.
 */
export function useInstallRecords(storageKeys) {
  const [records, setRecords] = useState(() => storageKeys.map(readRecord));
  useEffect(
    () =>
      subscribeInstallRecords((key) => {
        if (storageKeys.includes(key)) setRecords(storageKeys.map(readRecord));
      }),
    [storageKeys],
  );
  return records;
}

/**
 * @param {string} storageKey ключ редактора в хранилище браузера
 * @returns {{
 *   record: object|null,
 *   rollingBack: boolean,
 *   remember: (installed: object, extra?: object) => object|null,
 *   forget: () => void,
 *   rollback: () => Promise<boolean>,
 * }}
 */
export function useInstallRecord(storageKey) {
  const [record, setRecord] = useState(() => readRecord(storageKey));
  const [rollingBack, setRollingBack] = useState(false);

  /* Откат долгий: редактор могут закрыть, пока он идёт. Состояние после
     размонтирования не трогаем — запись в хранилище при этом всё равно
     обновляется. */
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* Запись кладёт очередь применения, а редактор в это время открыт: без
     подписки «Откатить» у него не появилась бы до следующего открытия. */
  useEffect(
    () =>
      subscribeInstallRecords((key) => {
        if (key === storageKey) setRecord(readRecord(storageKey));
      }),
    [storageKey],
  );

  /**
   * Запоминает установку. Результат без `id` не запоминается вовсе: пустая
   * запись зажгла бы «Откатить», которая ответила бы ошибкой.
   */
  const remember = useCallback(
    (installed, extra = {}) => {
      void rememberInstallRecord(storageKey, installed, extra);
      return readRecord(storageKey);
    },
    [storageKey],
  );

  const forget = useCallback(() => {
    writeRecord(storageKey, null);
    setRecord(null);
  }, [storageKey]);

  /**
   * Возвращает игру к состоянию до установки. Бросает — вызывающий сам решает,
   * как сказать об этом человеку: у одних редакторов это тост, у других строка
   * в диалоге.
   */
  const rollback = useCallback(async () => {
    if (!hasRestorePoint(record) && !hasLayerMod(record)) return false;
    setRollingBack(true);
    try {
      /* Откат — удаление одной работы из библиотеки: снимается и тогда, когда
         поверх неё поставили что-то ещё. */
      /* Папку игры запись называет сама, если знает: мод слоя без точки
         отката не подскажет её библиотеке, как подсказывает манифест точки. */
      const removed = await rollBackInstall({
        install: record,
        ...(typeof record.gameRoot === "string" && record.gameRoot
          ? { gameRoot: record.gameRoot }
          : {}),
      });
      writeRecord(storageKey, null);
      if (alive.current) setRecord(null);
      /* Ступень «Ухудшения текстур» и растительность, собранные поверх
         снятой работы (места, вода), собираются заново уже без неё — иначе
         снятый облик остался бы в игре вдали (задача 5 ТЗ 06.10.2026, вечер). */
      const { refreshAfterRemoval } = await import("./install-queue/tasks/recolor.js");
      await refreshAfterRemoval(removed);
      return true;
    } finally {
      if (alive.current) setRollingBack(false);
    }
  }, [record, storageKey]);

  return { record, rollingBack, remember, forget, rollback };
}
