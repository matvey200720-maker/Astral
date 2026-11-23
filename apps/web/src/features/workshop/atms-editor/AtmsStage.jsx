/*
 * Кадр редактора «Банкоматы».
 *
 * Банкоматы — штатные модели и листы игры игрока (сцена описи: модели в
 * ряд, у настенных — стена за спиной), на общей матовой плашке редакторов
 * (`ModelStage`), камера — общая на всю мастерскую (`stage-camera.js`): ЛКМ
 * — вращение, щелчок ПКМ — полёт, колесо — приближение. Вкладка «Все»
 * показывает все модели рядом, вкладка модели — только её, крупно, с
 * человеком для масштаба.
 *
 * Облик частей — тем же расчётом, что у установщика (`atms-text.js`): цвет
 * корпуса и рамки палитрой, отделка панели, своя картинка экрана, вывески и
 * полосы — составным листом (`atms-composites.js`), свечение.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFinishTexture } from "../finish/finish-textures.js";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { atmAimTarget, atmPartSpec } from "./atms-aim.js";
import { useAtmComposites } from "./atms-composites.js";
import { ATMS_SCENE_URL, atmFrameLook, atmsPlanText, finishSurfaces, partLabel, sceneTypeIndex, targetLabel } from "./atms-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelOf, labelled } from "../model-stage/hover-label.js";

/* Текстура отделки одной поверхности: хук на поверхность, ответ — наверх. */
const FinishProbe = memo(function FinishProbe({ id, settings, onTexture }) {
  const texture = useFinishTexture(settings);
  useEffect(() => onTexture(id, texture), [id, texture, onTexture]);
  return null;
});

/** Текстуры отделки панели работы по ключу `<модель|all>:panel` и их пробы. */
export function useAtmFinishes(project) {
  const surfaces = useMemo(() => finishSurfaces(project), [project]);
  const [textures, setTextures] = useState({});
  const onTexture = useCallback((id, texture) => setTextures((current) => (current[id] === texture ? current : { ...current, [id]: texture })), []);
  const probes = Object.entries(surfaces)
    .filter(([, settings]) => ["pattern", "image", "gradient"].includes(settings?.mode))
    .map(([id, settings]) => <FinishProbe key={id} id={id} settings={settings} onTexture={onTexture} />);
  return { textures, probes };
}

/**
 * Рамка кадра: все модели рядом или одна крупно, спереди и чуть сбоку.
 * `thumb` — снимок плитки: без человека, весь вид в кадре.
 */
export function atmsFrame(target, { thumb = false } = {}) {
  const index = sceneTypeIndex(target);
  return (asset) => {
    const part = index >= 0 ? asset.parts[index] : null;
    /* Снимок плитки садит кадр по коробке сам (`fittedFrame`): zoom 1 — «влезает». Одна модель на плитке — плотнее
       посадки (`crop`): высокая тумба в широкой плитке иначе выходит мелкой. */
    const crop = thumb && index >= 0;
    const zoom = crop ? 0.82 : thumb ? 1 : index >= 0 ? 1.25 : 1.12;
    return {
      ...(crop ? { crop: true } : {}),
      bounds: part?.bounds || asset.bounds,
      ground: true,
      person: index >= 0 && !thumb,
      view: { yaw: index >= 0 ? -0.38 : -0.26, pitch: thumb ? 0.08 : 0.14, zoom },
    };
  };
}

/* `onAim(aim)` — щелчок по части банкомата (`atmAimTarget`); `highlight` — выбранная часть (`atmPartSpec`) или `null`. */
export default function AtmsStage({ project, target = "all", onCamera = null, onAim = null, highlight = null }) {
  useTr();
  const stageRef = useRef(null);
  const { textures, probes } = useAtmFinishes(project);
  const composites = useAtmComposites(project);
  const look = useCallback((index, info) => atmFrameLook(project, info, { finishes: textures, composites }), [project, textures, composites]);
  const index = sceneTypeIndex(target);
  const parts = useMemo(() => (index >= 0 ? [index] : null), [index]);
  const frame = useMemo(() => atmsFrame(target), [target]);
  const label = `${targetLabel(target)}: ${tr("облик работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")}`;
  /* Под курсором подсвечивается та часть той модели, что откроется по щелчку; то, что правке не поддаётся (рельеф, стекло, стена), — нет. */
  const aimTarget = useCallback((hit) => {
    const aim = atmAimTarget(hit);
    /* Подпись у курсора: часть и модель — «Корпус · Настенный синий». */
    return aim ? labelled(atmPartSpec(aim.target, aim.part), labelOf(partLabel(aim.part), targetLabel(aim.target))) : null;
  }, []);
  const aim = useCallback(
    (hit) => {
      const found = atmAimTarget(hit);
      if (found) onAim(found);
    },
    [onAim],
  );

  return (
    <div className="fx-stage recolor-stage is-studio atms-stage">
      {probes}
      <ModelStage loadKit="props"
        ref={stageRef}
        scene={ATMS_SCENE_URL}
        look={look}
        parts={parts}
        frame={frame}
        frameKey={target}
        onCamera={onCamera}
        onAim={onAim ? aim : null}
        aimTarget={aimTarget}
        highlight={highlight}
        label={label}
      />
      {/* Что уедет в игру — строка состояния работы; откуда модели и листы, кадру говорить незачем (обход кадров 29.10.2026). */}
      <StageNote>{atmsPlanText(project)}</StageNote>
      <StageSheetsNote />
    </div>
  );
}
