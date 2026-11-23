/*
 * Готовые виды маппинга — сеткой в панели «Шаблоны», как готовые заводы.
 * Плитка — настоящие здания фермы в облике вида: снимок той же 3D-сцены,
 * что в кадре.
 */

import { memo, useCallback, useMemo } from "react";
import {
  MAPPING_LOCATIONS,
  MAPPING_PRESETS,
  applyMappingPreset,
  findMappingLocation,
  mappingProjectSignature,
  matchingMappingPreset,
  normalizeMappingProject,
} from "@modovik/climb-contract/recolor/mapping";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { mappingFrameLook, mappingSceneOf, mappingShowcaseFrame } from "./mapping-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/**
 * Маппинг в облике работы — 3D-снимок фермы, главного места мода (плитка,
 * обложка); `location` — другое место.
 */
export function MappingArt({ project, location = "farm" }) {
  const normal = useMemo(() => normalizeMappingProject(project), [project]);
  const place = findMappingLocation(location) || MAPPING_LOCATIONS[0];
  const look = useCallback((index, info) => mappingFrameLook(normal, info), [normal]);
  /* Место как в игре — штатные здания из игры игрока, иначе модели мода. */
  return (
    <SceneThumb scene={mappingSceneOf(place, normal)} look={look} lookKey={mappingProjectSignature(normal)} frame={mappingShowcaseFrame} />
  );
}

/* Исходные виды — словами п. 15 `design-qa.md`: «Как в игре» и то, что в кадре, а не «Стандарт GTA» и «Как в моде». */
const PRESET_TITLES = Object.freeze({ stock: "Как в игре", mod: "Модели мода" });

/*
 * `open` и `onToggle` — управляемая полка «Облика» (ТЗ 22.10): пока она свёрнута, плитки не создаются вовсе — их 3D-снимки
 * не должны сниматься при входе в редактор, даже если окно не умеет отличить свёрнутое от видимого.
 */
function MappingPresets({ project, onApply, collapsible = false, open = undefined, onToggle = undefined }) {
  useTr();
  const current = matchingMappingPreset(project);
  const shown = !collapsible || open !== false;
  return (
    <PresetShelf
      title={tr("Готовые виды")}
      label={tr("Готовые виды маппинга")}
      className="recolor-presets"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      {shown && MAPPING_PRESETS.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<MappingArt project={applyMappingPreset({}, preset.id)} location={preset.location || "farm"} />}
          title={tr(PRESET_TITLES[preset.id] || preset.label)}
          tooltip={tr(preset.description)}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(MappingPresets);
