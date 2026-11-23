/*
 * Установка из редактора без проекта студии: небо, килл-эффект, эффекты.
 *
 * У этих редакторов нет проекта в каталоге мастерской — у них одна текущая
 * правка в своём ключе хранилища. Порядок установки:
 *
 *   1. пакет уезжает в игру;
 *   2. запись установки запоминает точку отката, снимок поставленного и
 *      убирает прежнюю версию.
 *
 * В «Мои работы» установка не пишет (владелец, 24.09.2026): туда попадает
 * только то, что человек сохранил сам. Снимок поставленного живёт в самой
 * записи (`installedState`) — по нему обложка плитки рисует то, что в игре,
 * а «Мои работы» узнают, какая из сохранённых работ сейчас стоит.
 */

import { rememberInstallRecord } from "../../useInstallRecord.js";

/**
 * @param {{
 *   editor: string,
 *   storageKey: string,
 *   state: string|object,
 *   apply: () => Promise<object>,
 *   details?: (result: object) => object,
 *   report?: Function,
 * }} input
 */
export async function installEditorWork({
  editor,
  storageKey,
  state,
  apply,
  details = null,
  report = null,
}) {
  const result = await apply();
  const record = await rememberInstallRecord(
    storageKey,
    result,
    {
      ...(details?.(result) || {}),
      editor,
      installedState:
        typeof state === "string" ? state : JSON.stringify(state ?? null),
    },
    { report },
  );
  return { result, record };
}
