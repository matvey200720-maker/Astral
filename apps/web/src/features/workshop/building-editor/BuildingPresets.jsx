/*
 * Готовые виды здания — сеткой в панели «Шаблоны», как готовые заводы.
 *
 * Плитка — настоящее здание в облике вида: снимок той же 3D-сцены, что в
 * кадре, общим невидимым кадром снимков (`scene-snapshot.js`), со сторонами
 * и надписью-плашкой. Отмечена плитка, с которой работа совпадает.
 */

import { memo, useCallback, useMemo } from "react";
import {
  applyBuildingPreset,
  buildingInventory,
  buildingPresets,
  buildingProjectSignature,
  matchingBuildingPreset,
  normalizeBuildingProject,
} from "@modovik/climb-contract/recolor/buildings";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { finishTextureNow } from "../finish/finish-textures.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { buildingPlateObjectsNow } from "./building-art.js";
import { buildingFrameLook, buildingShowcaseFrame } from "./building-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Рамка снимка — в `building-text.js`: ею снимает и окно-съёмщик обложек. */
export { buildingShowcaseFrame };

/** Здание в облике работы — 3D-снимок настоящих моделей (плитка, обложка). */
export function BuildingArt({ place, project }) {
  const normal = useMemo(() => normalizeBuildingProject(place, project), [place, project]);
  const finishes = useMemo(
    () => ({ building: finishTextureNow(normal.building), ...Object.fromEntries(Object.entries(normal.parts).map(([id, part]) => [id, finishTextureNow(part)])) }),
    [normal],
  );
  const look = useCallback((index, info) => buildingFrameLook(normal, place, info, { finishes }), [normal, place, finishes]);
  const objects = useCallback(() => buildingPlateObjectsNow(normal, place), [normal, place]);
  const scene = buildingInventory(place)?.scenes?.[0];
  if (!scene) return null;
  return <SceneThumb scene={scene.url} look={look} lookKey={`${buildingProjectSignature(place, normal)}|close1`} frame={buildingShowcaseFrame(place, { close: true })} objects={objects} />;
}

function BuildingPresets({ place, project, onApply }) {
  useTr();
  const presets = buildingPresets(place);
  const current = matchingBuildingPreset(place, project);
  return (
    <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды здания")} className="recolor-presets" collapsible={false}>
      {presets.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<BuildingArt place={place} project={applyBuildingPreset(place, {}, preset.id)} />}
          /* Имя вида — название магазина («METRO», «IKEA»): прописные у него
             свои, а не крик интерфейса. */
          title={<span data-audit-ignore="caps">{preset.label}</span>}
          tooltip={tr(preset.description)}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(BuildingPresets);
