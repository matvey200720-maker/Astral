/*
 * Перенос мест в пакет мест (фикс 1 ТЗ 06.10.2026): главный процесс при
 * подготовке игры ставит поставленные раньше места теми же файлами в пакет
 * мест Astral и отвечает, какой пакет каким стал. Записи установок окна
 * смотрят на прежние id — их переписываем, иначе редактор и «Библиотека»
 * решили бы, что место не стоит.
 *
 * Модуль грузится по требованию из подготовки игры: стартовому куску он не
 * нужен.
 */

import { RECOLOR_INSTALL_KEYS } from "./install-queue/tasks/recolor.js";
import { renameInstallRecordMod } from "./useInstallRecord.js";

/** `migrated` — `[{ set, from, to }]` из ответа подготовки. Сколько записей переписано. */
export function rewriteMigratedPlaces(migrated = []) {
  let rewritten = 0;
  for (const item of Array.isArray(migrated) ? migrated : []) {
    const key = RECOLOR_INSTALL_KEYS[item?.set];
    if (key && renameInstallRecordMod(key, item.from, item.to)) rewritten += 1;
  }
  return rewritten;
}
