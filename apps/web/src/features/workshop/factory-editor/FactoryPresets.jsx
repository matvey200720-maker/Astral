/*
 * Готовые виды завода — сеткой в панели «Шаблоны», как готовые зоны и
 * прострелы.
 *
 * Плитка — настоящий завод в облике вида: снимок той же 3D-сцены, что в
 * кадре, общим невидимым кадром снимков (`scene-snapshot.js`). Отмечена
 * плитка, с которой работа совпадает.
 */

import { memo, useCallback, useMemo } from "react";
import {
  FACTORY_INVENTORY,
  FACTORY_PRESETS,
  applyFactoryPreset,
  factoryProjectSignature,
  matchingFactoryPreset,
  normalizeFactoryProject,
} from "@modovik/climb-contract/recolor/factory";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { finishTextureNow } from "../finish/finish-textures.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { factoryFrameLook, factoryShowcaseFrame } from "./factory-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/** Завод в облике работы — 3D-снимок настоящих моделей (плитка, обложка). */
export function FactoryArt({ project }) {
  const normal = useMemo(() => normalizeFactoryProject(project), [project]);
  /* Узор и градиент считаются сразу; своя картинка на снимке — только в
     кадре редактора. */
  const textures = useMemo(
    () =>
      Object.fromEntries([
        ...["buildings", "ground", "containers", "props"].map((id) => [id, finishTextureNow(normal[id])]),
        ...Object.entries(normal.parts).map(([id, part]) => [`part:${id}`, finishTextureNow(part)]),
      ]),
    [normal],
  );
  const look = useCallback((index, info) => factoryFrameLook(normal, info, { textures }), [normal, textures]);
  return (
    <SceneThumb
      scene={FACTORY_INVENTORY.scene.url}
      look={look}
      lookKey={factoryProjectSignature(normal)}
      frame={factoryShowcaseFrame}
    />
  );
}

/* Готовые заводы — в панели инструмента «Шаблоны»: сеткой без
   переключателя, видны сразу. */
function FactoryPresets({ project, onApply }) {
  useTr();
  const current = matchingFactoryPreset(project);
  return (
    <PresetShelf
      title={tr("Готовые заводы")}
      label={tr("Готовые виды завода")}
      className="recolor-presets"
      collapsible={false}
    >
      {FACTORY_PRESETS.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<FactoryArt project={applyFactoryPreset({}, preset.id)} />}
          /* Исходный вид — тем же словом, что откат по всей мастерской: «Как в игре» (разбор 30.10.2026). */
          title={preset.id === "standard" ? tr("Как в игре") : preset.id === "mod" ? tr("Серый мода") : tr(preset.label)}
          tooltip={tr(preset.description)}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(FactoryPresets);
