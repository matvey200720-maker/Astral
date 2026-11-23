/*
 * Залазы в игру.
 *
 * Проверка плана нужна коду — она ловит несовпадение папки игры и занятый
 * слот, — но человеку незачем знать, что шагов два. Он нажал «Применить»;
 * проверка идёт внутри применения и видна шагом «Подготовка».
 *
 * Готовность «к модам» здесь не спрашивается: она про ASI-загрузчик для
 * папки `mods`, а залазы едут прямой схемой слоя Astral — в настоящий
 * `update.rpf`, без загрузчика. Что мешает установке на самом деле —
 * запущенная игра, обновление в лаунчере, тень папки `mods`, чужой слой
 * Astral, — проверяет главный процесс и называет прямо.
 */

import {
  applyClimbCustomization,
  planClimbCustomization,
} from "../../../../api.js";
import { locateLegacyTarget } from "../game-root.js";
import { recordProjectInstallation } from "../project-installs.js";

export const CLIMBS_INSTALL_KIND = "local-legacy-climbs";

/**
 * `textures` — текстуры меток, нарисованные редактором в момент нажатия:
 * `{ spot: { data, width, height }, … }`, PNG в base64. Они едут только в
 * план: главный процесс собирает по ним модели, запоминает готовый пакет за
 * планом, и установка ставит ровно его — второй раз пять картинок через мост
 * окна не гоняются.
 *
 * @param {{project: object, design: object, textures?: object, report?: Function}} input
 */
export async function installClimbs({
  project,
  design,
  textures = {},
  report,
}) {
  const game = await locateLegacyTarget();
  const payload = {
    projectId: project.id || design.designId,
    design,
    gameRoot: game.path,
    targetId: game.id,
  };
  report?.({ step: "prepare" });
  const plan = await planClimbCustomization({ ...payload, textures });
  const installed = await applyClimbCustomization({
    ...payload,
    planId: plan.planId,
  });
  /*
   * Слот у залазов один: движок снял прежнюю метку этого проекта, и в списке
   * установок ей больше не место. Без этого список копил по записи на каждое
   * «Применить» — правка цвета давала вторую «активную» работу, которой в
   * игре нет.
   */
  const record = {
    ...installed,
    replacesInstallIds: (project.installations || [])
      .filter(
        (item) =>
          item.kind === CLIMBS_INSTALL_KIND &&
          item.status === "active" &&
          item.installId !== installed.installId,
      )
      .map((item) => item.installId),
  };
  recordProjectInstallation(project.id, record);
  return { record, installed };
}
