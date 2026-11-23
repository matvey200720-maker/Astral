/*
 * Животные в игру (05.11.2026).
 *
 * План собирает пакет облика в потоке чтения игры (перекраска листов, метка и свечение в модели тела) и говорит, стоит ли в
 * игре ровно такой же; установка ставит ровно собранное пакетом движка в свой контейнер слоя Astral. Прежний облик животных
 * уходит тем же движением — животные в игре одни; остальные работы мастерской не трогаются.
 *
 * Запись установки — мод слоя (`layerModId`): «Снять из игры» и корзина библиотеки снимают его как любой мод движка.
 */

import { applyAnimals, planAnimals } from "../../../../api.js";
import { tr } from "../../../../locales/ui.js";
import { animalEmblemsFor } from "../../animals-editor/animal-emblem.js";
import { forgetInstallRecord, rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

export const ANIMALS_INSTALL_KEY = "astral.animals.install.v1";

/**
 * @param {{ project: object, state: string, report?: Function }} input
 * @returns {Promise<{ result: object, record: object|null }>}
 */
export async function installAnimals({ project, state, report = null }) {
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  /* Свои эмблемы меток лежат в хранилище окна; установщик получает их PNG и сверяет с отпечатком. Нет картинки — отказ словами. */
  const { pictures, missing } = await animalEmblemsFor(project);
  if (missing.length) throw new Error(tr("Своей эмблемы метки нет на этом компьютере — выберите картинку заново"));
  const plan = await planAnimals({ gameRoot: game.path, project, pictures });
  const result = await applyAnimals({ gameRoot: game.path, planId: plan.planId });
  const record = await rememberInstallRecord(
    ANIMALS_INSTALL_KEY,
    { layerModId: result?.layerModId },
    {
      editor: "animals",
      gameRoot: game.path,
      installedState: state,
      animals: Array.isArray(result?.animals) ? result.animals.length : 0,
    },
    { report },
  );
  if (!record) forgetInstallRecord(ANIMALS_INSTALL_KEY);
  return { result: { ...result, project }, record };
}
