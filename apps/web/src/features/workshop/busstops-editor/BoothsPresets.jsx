/*
 * Готовые виды будок — сеткой в панели «Шаблоны», как готовые остановки.
 *
 * Плитка — настоящие будки в облике вида: снимок той же 3D-сцены, что в
 * кадре, общим невидимым кадром снимков (`scene-snapshot.js`). Отмечена
 * плитка, с которой работа совпадает.
 */

import { memo, useCallback, useMemo } from "react";
import { BOOTHS_PRESETS, applyBoothsPreset, boothsSignature, createBooths, matchingBoothsPreset, normalizeBooths } from "@modovik/climb-contract/recolor/busstop-booths";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { finishTextureNow } from "../finish/finish-textures.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { boothsFrame } from "./BoothsStage.jsx";
import { BOOTHS_SCENE_URL, boothFinishSurfaces, boothFrameLook, boothSceneIndex } from "./booths-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Видимые части снимка: одна будка — только она. */
const boothsThumbParts = (target) => (boothSceneIndex(target) >= 0 ? [boothSceneIndex(target)] : null);

/**
 * Будки в облике работы — 3D-снимок настоящих моделей: на плитке шаблона и на
 * обложке — обе будки рядом (`target="all"`). Свои картинки в снимок не входят:
 * снимок делается без хранилища окна.
 */
export function BoothsArt({ booths, target = "all" }) {
  const normal = useMemo(() => normalizeBooths(booths), [booths]);
  const finishes = useMemo(() => Object.fromEntries(Object.entries(boothFinishSurfaces(normal)).map(([key, settings]) => [key, finishTextureNow(settings)])), [normal]);
  const look = useCallback((index, info) => boothFrameLook(normal, info, { finishes }), [normal, finishes]);
  return (
    <SceneThumb scene={BOOTHS_SCENE_URL} look={look} lookKey={`booths:${target}|${JSON.stringify(boothsSignature(normal))}`} frame={boothsFrame(target, { thumb: true })} parts={boothsThumbParts(target)} />
  );
}

function BoothsPresets({ project, onApply }) {
  useTr();
  const current = matchingBoothsPreset(project.booths);
  return (
    <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды будок")} className="recolor-presets" collapsible={false}>
      {BOOTHS_PRESETS.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<BoothsArt booths={applyBoothsPreset(createBooths(), preset.id)} />}
          title={tr(preset.label)}
          tooltip={tr(preset.description)}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(BoothsPresets);
