/*
 * Групповые метки в игру (задача 21 ТЗ 18.10.2026, вечер).
 *
 * Работа уезжает одним нативным патчем со своей точкой отката (`group-markers-customizer.js` в
 * главном процессе): новые словари `x64/textures/script_txds.rpf/<словарь>.ytd`, в каждом — только
 * правленые листы. Запись установки запоминает точку, а прежняя версия уходит из стопки
 * (`rememberInstallRecord`).
 *
 * Вид игры при стоящей работе — «вернуть игре её метки»: листы ставятся штатными (`previous` —
 * работа, что стояла: её метки и возвращаются), а запись после этого забывается — от Astral в
 * игре ничего не осталось.
 */

import { groupMarkersSignature, groupMarkersWorkIsStock, normalizeGroupMarkersWork } from "@modovik/minimap-contract/group-markers";
import { applyGroupMarkers } from "../../../../api.js";
import { forgetInstallRecord, rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

export const GROUP_MARKERS_INSTALL_KEY = "astral.group-markers.install.v1";

/** Метки Rockstar — вид «Как в игре». */
export const STOCK_GROUP_MARKERS_WORK = normalizeGroupMarkersWork({});

/** Отпечаток работы для кнопки «Применить»: то, что уходит в игру. */
export const groupMarkersInstallSignature = (work) => groupMarkersSignature(work);

/**
 * `pictures` — свои картинки меток: отпечаток → PNG base64. `previous` — работа, что стоит в игре
 * сейчас (из записи установки), или `null`.
 *
 * @param {{ work: object, state: string, previous?: object|null, pictures?: Record<string, string>, report?: Function }} input
 * @returns {Promise<{ result: object, record: object|null }>}
 */
export async function installGroupMarkers({ work, state, previous = null, pictures = {}, report = null }) {
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const result = await applyGroupMarkers({
    gameRoot: game.path,
    project: work,
    ...(previous ? { previous } : {}),
    ...(Object.keys(pictures).length ? { pictures } : {}),
  });
  if (groupMarkersWorkIsStock(work)) {
    forgetInstallRecord(GROUP_MARKERS_INSTALL_KEY);
    return { result, record: null };
  }
  const record = await rememberInstallRecord(
    GROUP_MARKERS_INSTALL_KEY,
    result,
    {
      editor: "group-markers",
      gameRoot: game.path,
      installedState: state,
      summary: result?.summary || "",
    },
    { report },
  );
  return { result, record };
}
