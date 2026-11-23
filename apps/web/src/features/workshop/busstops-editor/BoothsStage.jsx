/*
 * Кадр «Будок» в редакторе «Остановки» (задача 11 ТЗ 18.10.2026).
 *
 * Будки — штатные модели и листы игры игрока (сцена описи: две будки в ряд),
 * на общей матовой плашке редакторов (`ModelStage`), камера — общая на всю
 * мастерскую (`stage-camera.js`): ЛКМ — вращение, щелчок ПКМ — полёт,
 * колесо — приближение. Вкладка «Обе» показывает обе будки рядом, вкладка
 * будки — только её, крупно, с человеком для масштаба.
 *
 * Облик частей — тем же расчётом, что у установщика (`booths-text.js`): цвет
 * корпуса, козырька и рам палитрой, отделка крыши и пола, своя картинка
 * надписей и листков — составным листом (`booths-composites.js`).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFinishTexture } from "../finish/finish-textures.js";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { boothAimTarget, boothPartSpec } from "./booths-aim.js";
import { useBoothComposites } from "./booths-composites.js";
import { BOOTHS_SCENE_URL, boothFinishSurfaces, boothFrameLook, boothPartLabel, boothSceneIndex, boothTargetLabel, boothsPlanText } from "./booths-text.js";
import { useTr } from "../../../locales/ui.js";
import { labelOf, labelled } from "../model-stage/hover-label.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Текстура отделки одной поверхности: хук на поверхность, ответ — наверх. */
const FinishProbe = memo(function FinishProbe({ id, settings, onTexture }) {
  const texture = useFinishTexture(settings);
  useEffect(() => onTexture(id, texture), [id, texture, onTexture]);
  return null;
});

/** Текстуры отделки крыши и пола работы по ключу `<будка|booths>:<часть>` и их пробы. */
export function useBoothFinishes(booths) {
  const surfaces = useMemo(() => boothFinishSurfaces(booths), [booths]);
  const [textures, setTextures] = useState({});
  const onTexture = useCallback((id, texture) => setTextures((current) => (current[id] === texture ? current : { ...current, [id]: texture })), []);
  const probes = Object.entries(surfaces)
    .filter(([, settings]) => ["pattern", "image", "gradient"].includes(settings?.mode))
    .map(([id, settings]) => <FinishProbe key={id} id={id} settings={settings} onTexture={onTexture} />);
  return { textures, probes };
}

/**
 * Рамка кадра: обе будки рядом или одна крупно, спереди и чуть сбоку.
 * `thumb` — снимок плитки: без человека, обе будки в кадре.
 */
export function boothsFrame(target, { thumb = false } = {}) {
  const index = boothSceneIndex(target);
  return (asset) => {
    const part = index >= 0 ? asset.parts[index] : null;
    /* Снимок плитки садит кадр по коробке сам (`fittedFrame`): zoom 1 — «влезает». */
    const zoom = thumb ? 1 : index >= 0 ? 1.25 : 1.12;
    return {
      bounds: part?.bounds || asset.bounds,
      ground: true,
      person: index >= 0 && !thumb,
      view: { yaw: index >= 0 ? -0.55 : -0.42, pitch: thumb ? 0.12 : 0.16, zoom },
    };
  };
}

/* `onAim(aim)` — щелчок по части будки (`boothAimTarget`); `highlight` — выбранная часть (`boothPartSpec`) или `null`. */
export default function BoothsStage({ project, target = "all", onCamera = null, onAim = null, highlight = null }) {
  useTr();
  const stageRef = useRef(null);
  const booths = project?.booths ?? project;
  const { textures, probes } = useBoothFinishes(booths);
  const composites = useBoothComposites(booths);
  const look = useCallback((index, info) => boothFrameLook(booths, info, { finishes: textures, composites }), [booths, textures, composites]);
  const index = boothSceneIndex(target);
  const parts = useMemo(() => (index >= 0 ? [index] : null), [index]);
  const frame = useMemo(() => boothsFrame(target), [target]);
  const label = trFill("{0} в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.", boothTargetLabel(target));
  /* Под курсором подсвечивается та часть той будки, что откроется по щелчку; то, что правке не поддаётся (замок, постеры, лампа), — нет. */
  const aimTarget = useCallback((hit) => {
    const aim = boothAimTarget(hit);
    /* Подпись у курсора: часть и будка. */
    return aim ? labelled(boothPartSpec(aim.target, aim.part), labelOf(boothPartLabel(aim.part), boothTargetLabel(aim.target))) : null;
  }, []);
  const aim = useCallback(
    (hit) => {
      const found = boothAimTarget(hit);
      if (found) onAim(found, hit);
    },
    [onAim],
  );

  return (
    <div className="fx-stage recolor-stage is-studio busstops-stage booths-stage">
      {probes}
      <ModelStage loadKit="props"
        ref={stageRef}
        scene={BOOTHS_SCENE_URL}
        look={look}
        parts={parts}
        frame={frame}
        frameKey={`booths:${target}`}
        onCamera={onCamera}
        onAim={onAim ? aim : null}
        aimTarget={aimTarget}
        highlight={highlight}
        label={label}
      />
      {/* Что уедет в игру — строка состояния работы; откуда модели и листы, кадру говорить незачем (обход кадров 29.10.2026). */}
      <StageNote>{boothsPlanText(booths)}</StageNote>
      <StageSheetsNote />
    </div>
  );
}
