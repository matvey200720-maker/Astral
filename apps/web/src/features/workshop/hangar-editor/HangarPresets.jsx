/*
 * Готовые ангары — сеткой в панели «Шаблоны», как готовые заводы. Плитка —
 * настоящий ангар в облике вида: снимок той же 3D-сцены, что в кадре
 * (штатный ангар игры игрока), снаружи со стороны ворот. Фермы, кран, лампы,
 * эмблемы и надписи готовый вид не трогает — они свои у каждого.
 */

import { memo, useCallback, useMemo } from "react";
import {
  HANGAR_INVENTORY,
  HANGAR_PRESETS,
  applyHangarPreset,
  hangarProjectSignature,
  matchingHangarPreset,
  normalizeHangarProject,
} from "@modovik/climb-contract/recolor/hangar";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { finishTextureNow } from "../finish/finish-textures.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { hangarFrameLook, hangarShowcaseFrame } from "./hangar-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/**
 * Ангар в облике работы — 3D-снимок настоящих моделей снаружи (плитка,
 * обложка). Эмблема и надпись висят изнутри — снаружи их не видно, в снимок
 * они не входят.
 */
export function HangarArt({ project }) {
  const normal = useMemo(() => normalizeHangarProject(project), [project]);
  const textures = useMemo(
    () => ({
      outside: finishTextureNow(normal.outside),
      inside: finishTextureNow(normal.inside),
      floor: finishTextureNow(normal.floor),
    }),
    [normal],
  );
  const look = useCallback(
    (index, info) => hangarFrameLook(normal, info, { textures }),
    [normal, textures],
  );
  return (
    <SceneThumb
      scene={HANGAR_INVENTORY.scene.url}
      look={look}
      lookKey={hangarProjectSignature({ ...normal, emblems: [] })}
      frame={hangarShowcaseFrame}
    />
  );
}

function HangarPresets({ project, onApply }) {
  useTr();
  const current = matchingHangarPreset(project);
  return (
    <PresetShelf
      title={tr("Готовые ангары")}
      label={tr("Готовые виды ангара")}
      className="recolor-presets"
      collapsible={false}
    >
      {HANGAR_PRESETS.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<HangarArt project={applyHangarPreset({}, preset.id)} />}
          /* Исходный вид — тем же словом, что откат по всей мастерской: «Как в игре» (разбор 30.10.2026). */
          title={preset.id === "standard" ? tr("Как в игре") : tr(preset.label)}
          tooltip={tr(preset.description)}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(HangarPresets);
