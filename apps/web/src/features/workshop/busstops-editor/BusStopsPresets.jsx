/*
 * Готовые виды остановок — сеткой в панели «Шаблоны», как готовые здания.
 *
 * Плитка — настоящие остановки в облике вида: снимок той же 3D-сцены, что в
 * кадре, общим невидимым кадром снимков (`scene-snapshot.js`). Отмечена
 * плитка, с которой работа совпадает.
 */

import { memo, useCallback, useMemo } from "react";
import {
  BUSSTOPS_PRESETS,
  applyBusStopsPreset,
  busStopsProjectSignature,
  createBusStopsProject,
  matchingBusStopsPreset,
  normalizeBusStopsProject,
} from "@modovik/climb-contract/recolor/busstops";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { finishTextureNow } from "../finish/finish-textures.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { busStopsFrame } from "./BusStopsStage.jsx";
import { BUSSTOPS_SCENE_URL, busStopFrameLook, finishSurfaces, sceneTypeIndex } from "./busstops-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Видимые части снимка: один вид — только он. */
const busStopsThumbParts = (target) => (sceneTypeIndex(target) >= 0 ? [sceneTypeIndex(target)] : null);

/**
 * Остановки в облике работы — 3D-снимок настоящих моделей: на плитке
 * шаблона — навес с подсветкой крупно (на нём видны все части), на обложке
 * полки — все виды рядом (`target="all"`).
 */
export function BusStopsArt({ project, target = "lit" }) {
  const normal = useMemo(() => normalizeBusStopsProject(project), [project]);
  const finishes = useMemo(() => Object.fromEntries(Object.entries(finishSurfaces(normal)).map(([key, settings]) => [key, finishTextureNow(settings)])), [normal]);
  const look = useCallback((index, info) => busStopFrameLook(normal, info, { finishes }), [normal, finishes]);
  return <SceneThumb scene={BUSSTOPS_SCENE_URL} look={look} lookKey={`${target}|${busStopsProjectSignature(normal)}`} frame={busStopsFrame(target, { thumb: true })} parts={busStopsThumbParts(target)} />;
}

function BusStopsPresets({ project, onApply }) {
  useTr();
  const current = matchingBusStopsPreset(project);
  return (
    <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды остановок")} className="recolor-presets" collapsible={false}>
      {BUSSTOPS_PRESETS.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<BusStopsArt project={applyBusStopsPreset(createBusStopsProject(), preset.id)} />}
          title={preset.label}
          tooltip={preset.description}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(BusStopsPresets);
