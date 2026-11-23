import { optimizationLayerTitle } from "@modovik/optimizer/layer-ids.js";
import { installedOptimizationLayers, installedOptimizationSet } from "../workshop/optimization-layer-records.js";
import { readAppliedOptimizerSummary } from "./libraryInstalled.js";
import { tr } from "../../locales/ui.js";

export const OPTIMIZER_ROW_ID = "optimizer-profile";

// Название настройки приходит из словаря библиотеки; нестроку отдаём как есть (поведение прежней версии).
const profileName = (copy) => copy?.library?.optimization?.profile || "";

const modUnit = (modId, name, extra) => ({ key: `mod:${modId}`, kind: "mod", modId, name, ...extra });

export function optimizerUnitOf(libraryCopy, storage = globalThis.localStorage) {
  const applied = readAppliedOptimizerSummary(storage);
  return (
    applied && {
      key: "optimizer",
      kind: "optimizer",
      name: profileName(libraryCopy),
      restorePointId: applied.restorePointId,
      settingsPrevious: applied.settingsPrevious,
    }
  );
}

export function optimizationKnownUnits(libraryCopy, storage = globalThis.localStorage) {
  return [optimizerUnitOf(libraryCopy, storage)].filter(Boolean);
}

export function optimizationEntries(libraryCopy, locale = "ru", storage = globalThis.localStorage) {
  const layers = installedOptimizationLayers(storage);
  // Набор слоёв — один мод (layerModId записи набора); в корзине он идёт после настройки и перед отдельными слоями.
  const setId = installedOptimizationSet(storage)?.layerModId;
  const units = [
    optimizerUnitOf(libraryCopy, storage),
    setId && modUnit(setId, tr("Слои оптимизации"), { origin: { type: "optimization-set" } }),
    ...layers.map(({ layerId, record }) => modUnit(record.layerModId, optimizationLayerTitle(layerId, locale))),
  ].filter(Boolean);
  return units.length ? [{ id: OPTIMIZER_ROW_ID, title: profileName(libraryCopy), units }] : [];
}
