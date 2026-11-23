/*
 * «Дым из-под колёс» в игру (ТЗ 11.10.2026, вечер).
 *
 * Работа уезжает одним нативным патчем со своей точкой отката
 * (`wheel-smoke.js` в главном процессе): клоны правил дыма в ядре игрока и
 * таблица колёс `wheelfx.dat` с их именами. Запись установки запоминает
 * точку, а прежняя версия уходит из стопки (`rememberInstallRecord`).
 *
 * «Как в игре» после своей работы — тоже установка: клоны снимаются, в
 * таблице снова штатные имена. Вернуть файлы игры целиком — «Снять из
 * игры», точкой отката.
 */

import { applyWheelSmoke } from "../../../../api.js";
import { rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

export const WHEEL_SMOKE_INSTALL_KEY = "astral.wheel-smoke.install.v1";

/**
 * @param {{ project: object, state: string, report?: Function }} input
 * @returns {Promise<{ result: object, record: object|null }>}
 */
export async function installWheelSmoke({ project, state, report = null }) {
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const result = await applyWheelSmoke({ gameRoot: game.path, project });
  const record = await rememberInstallRecord(
    WHEEL_SMOKE_INSTALL_KEY,
    result,
    {
      editor: "wheel-smoke",
      gameRoot: game.path,
      installedState: state,
      summary: result?.summary || "",
    },
    { report },
  );
  return { result, record };
}
