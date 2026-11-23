/*
 * Эффекты попадания на экране в игру (задача 3 ТЗ 04.10.2026).
 *
 * Работа уезжает одним нативным патчем со своей точкой отката
 * (`screen-hits-customizer.js` в главном процессе): ключи
 * `misc.DamageOverlay.*` в visualsettings.dat и, если картинка не «как в
 * игре», капля `dmg_overlay_fade` в graphics.ytd. Запись установки
 * запоминает точку, а прежняя версия уходит из стопки (`rememberInstallRecord`).
 *
 * Штатный вид при стоящей работе — это «вернуть игре её след»: он ставится
 * так же, а запись после него забывается — откатывать нечего, от Astral в
 * игре ничего не осталось.
 */

import {
  applyScreenHitsPreset,
  createScreenHitsProject,
  screenHitsIsVanilla,
} from "@modovik/kill-effects/screen-hits.js";
import { applyScreenHits } from "../../../../api.js";
import { forgetInstallRecord, rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

export const SCREEN_HITS_INSTALL_KEY = "astral.screen-hits.install.v1";

/** След Rockstar — вид «Как в игре». */
export const STOCK_SCREEN_HITS = applyScreenHitsPreset(createScreenHitsProject(), "vanilla");

/**
 * `picture` — квадрат своей картинки (PNG base64) или `null`.
 *
 * @param {{ project: object, state: string, picture?: string|null, report?: Function }} input
 * @returns {Promise<{ result: object, record: object|null }>}
 */
export async function installScreenHits({ project, state, picture = null, report = null }) {
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const result = await applyScreenHits({
    gameRoot: game.path,
    project,
    ...(picture ? { picture: { data: picture, mime: "image/png" } } : {}),
  });
  if (screenHitsIsVanilla(project)) {
    forgetInstallRecord(SCREEN_HITS_INSTALL_KEY);
    return { result, record: null };
  }
  const record = await rememberInstallRecord(
    SCREEN_HITS_INSTALL_KEY,
    result,
    {
      editor: "screen-hits",
      gameRoot: game.path,
      installedState: state,
      summary: result?.summary || "",
      texture: result?.texture || "",
    },
    { report },
  );
  return { result, record };
}
