/*
 * Прострелы в игру.
 *
 * План собирает набор в главном процессе (оболочки с обликом работы, типы,
 * расстановка, манифест) и говорит, стоит ли в игре ровно такой же;
 * установка ставит ровно собранное пакетом движка в свой контейнер слоя
 * Astral. Прежний набор прострелов уходит тем же движением — прострелы в
 * игре одни; залазы и остальные моды не трогаются.
 *
 * Запись установки — мод слоя (`layerModId`): «Откатить» и корзина
 * библиотеки снимают его как любой мод движка.
 */

import { applyWallbang, planWallbang } from "../../../../api.js";
import {
  forgetInstallRecord,
  rememberInstallRecord,
} from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

export const WALLBANG_INSTALL_KEY = "astral.wallbang.install.v1";

/**
 * @param {{ project: object, state: string, report?: Function }} input
 * @returns {Promise<{ result: object, record: object|null }>}
 */
export async function installWallbang({ project, state, report = null }) {
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const plan = await planWallbang({ gameRoot: game.path, project });
  const result = await applyWallbang({
    gameRoot: game.path,
    planId: plan.planId,
  });
  const record = await rememberInstallRecord(
    WALLBANG_INSTALL_KEY,
    { layerModId: result?.layerModId },
    {
      editor: "wallbang",
      gameRoot: game.path,
      installedState: state,
      objects: result?.visible ?? 0,
      places: result?.places ?? 0,
    },
    { report },
  );
  if (!record) forgetInstallRecord(WALLBANG_INSTALL_KEY);
  return { result, record };
}
