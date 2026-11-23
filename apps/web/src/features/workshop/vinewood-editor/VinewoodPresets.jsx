/*
 * Готовые виды надписи — сеткой в панели «Шаблоны». Плитка — тот же холм
 * в облике вида: снимок 3D-сцены общим кадром снимков (`scene-snapshot.js`)
 * с буквами и лесами вида (без листа металла: снимок не ждёт листов игры).
 */

import { memo, useCallback, useMemo } from "react";
import {
  VINEWOOD_INVENTORY,
  applyVinewoodPreset,
  matchingVinewoodPreset,
  normalizeVinewoodProject,
  vinewoodPresets,
  vinewoodProjectSignature,
} from "@modovik/climb-contract/recolor/vinewood";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { vinewoodFrameLook, vinewoodObjects } from "./vinewood-art.js";
import { vinewoodFrame } from "./VinewoodStage.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/**
 * Холм с надписью в облике работы — 3D-снимок (плитка, обложка). `logo` —
 * пиксели своего логотипа (`useVinewoodLogo`): без них логотипа на снимке
 * нет, и снимок с ним — свой (`lookKey`).
 */
export function VinewoodArt({ project, logo = null }) {
  const normal = useMemo(() => normalizeVinewoodProject(project), [project]);
  const look = useCallback((index, info) => vinewoodFrameLook(normal, info), [normal]);
  const objects = useCallback(() => vinewoodObjects(normal, { detail: "thumb", logo }), [normal, logo]);
  const scene = VINEWOOD_INVENTORY.scenes?.[0];
  if (!scene) return null;
  const key = `${vinewoodProjectSignature(normal)}${normal.mode === "logo" && logo ? `:${logo.width}x${logo.height}` : ""}`;
  return <SceneThumb scene={scene.url} look={look} lookKey={key} frame={vinewoodFrame} objects={objects} />;
}

function VinewoodPresets({ project, onApply }) {
  useTr();
  const presets = vinewoodPresets();
  const current = matchingVinewoodPreset(project);
  return (
    <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды надписи")} className="recolor-presets" collapsible={false}>
      {presets.map((preset) => {
        /* Слово на холме (ВАЙНВУД) остаётся своим; названия видов («Радуга», «Неон», «Без надписи», «Как в игре») — интерфейс и переводятся. */
        const word = preset.project?.mode === "text" && preset.project.text === preset.label;
        return (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<VinewoodArt project={applyVinewoodPreset({}, preset.id)} />}
          /* Имя вида — само слово на холме (LOS SANTOS, ВАЙНВУД), как
             логотип: правило «крик прописными» к нему не относится. */
          title={<span data-audit-ignore="caps" lang={word && /[Ѐ-ӿ]/.test(preset.label) ? "ru" : undefined}>{word ? preset.label : tr(preset.label)}</span>}
          tooltip={preset.description}
          onClick={() => onApply(preset)}
        />
        );
      })}
    </PresetShelf>
  );
}

export default memo(VinewoodPresets);
