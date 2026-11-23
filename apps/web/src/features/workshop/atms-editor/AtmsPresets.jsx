/*
 * Готовые виды банкоматов — сеткой в панели «Шаблоны», как готовые
 * остановки.
 *
 * Плитка — настоящие банкоматы в облике вида: снимок той же 3D-сцены, что в
 * кадре, общим невидимым кадром снимков (`scene-snapshot.js`). Отмечена
 * плитка, с которой работа совпадает. Свои картинки в снимок не входят:
 * снимок делается без хранилища окна.
 */

import { memo, useCallback, useMemo } from "react";
import {
  ATMS_PRESETS,
  applyAtmsPreset,
  atmsProjectSignature,
  createAtmsProject,
  matchingAtmsPreset,
  normalizeAtmsProject,
} from "@modovik/climb-contract/recolor/atms";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { finishTextureNow } from "../finish/finish-textures.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { atmsFrame } from "./AtmsStage.jsx";
import { ATMS_SCENE_URL, atmFrameLook, finishSurfaces, sceneTypeIndex } from "./atms-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Видимые части снимка: одна модель — только она. */
const atmsThumbParts = (target) => (sceneTypeIndex(target) >= 0 ? [sceneTypeIndex(target)] : null);

/**
 * Банкоматы в облике работы — 3D-снимок настоящих моделей: на плитке
 * шаблона — тумба крупно, на обложке полки — все модели рядом (`target="all"`).
 * Тумба, а не настенный синий: у настенных корпус — тёмная коробка в нише, и
 * «Графит», «Золото», «Неон» выходили одинаковыми с «Как в игре» (п. 20
 * `design-qa.md`, четвёртый круг критика 31.10.2026); у тумбы корпус —
 * вся видимая модель, а экран — её лицо («Выключенные»).
 */
export function AtmsArt({ project, target = "kiosk" }) {
  const normal = useMemo(() => normalizeAtmsProject(project), [project]);
  const finishes = useMemo(() => Object.fromEntries(Object.entries(finishSurfaces(normal)).map(([key, settings]) => [key, finishTextureNow(settings)])), [normal]);
  const look = useCallback((index, info) => atmFrameLook(normal, info, { finishes }), [normal, finishes]);
  return <SceneThumb scene={ATMS_SCENE_URL} look={look} lookKey={`${target}|${atmsProjectSignature(normal)}`} frame={atmsFrame(target, { thumb: true })} parts={atmsThumbParts(target)} />;
}

function AtmsPresets({ project, onApply }) {
  useTr();
  const current = matchingAtmsPreset(project);
  return (
    <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды банкоматов")} className="recolor-presets" collapsible={false}>
      {ATMS_PRESETS.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<AtmsArt project={applyAtmsPreset(createAtmsProject(), preset.id)} />}
          title={tr(preset.label)}
          tooltip={tr(preset.description)}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(AtmsPresets);
