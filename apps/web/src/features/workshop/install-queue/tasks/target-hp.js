/*
 * «Полоска HP» в игру (задача 2 ТЗ 11.10.2026).
 *
 * Работа уезжает одним нативным патчем со своей точкой отката
 * (`target-hp-customizer.js` в главном процессе): метка игрока
 * `mp_gamer_info.gfx` со своей полоской. Запись установки запоминает точку,
 * а прежняя версия уходит из стопки (`rememberInstallRecord`).
 *
 * Полоска «как в игре» — тоже установка: своя полоска встаёт и выглядит
 * как штатная (по умолчанию редактор начинается с неё). Вернуть игре её
 * файл — «Снять из игры», точкой отката.
 */

import { applyTargetHp } from "../../../../api.js";
import { rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

export const TARGET_HP_INSTALL_KEY = "astral.target-hp.install.v1";

/**
 * @param {{ project: object, state: string, report?: Function }} input
 * @returns {Promise<{ result: object, record: object|null }>}
 */
export async function installTargetHp({ project, state, report = null }) {
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const result = await applyTargetHp({ gameRoot: game.path, project });
  const record = await rememberInstallRecord(
    TARGET_HP_INSTALL_KEY,
    result,
    {
      editor: "target-hp",
      gameRoot: game.path,
      installedState: state,
      summary: result?.summary || "",
    },
    { report },
  );
  return { result, record };
}
