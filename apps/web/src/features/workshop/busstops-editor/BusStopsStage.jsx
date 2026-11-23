/*
 * Кадр редактора «Остановки».
 *
 * Остановки — штатные модели и листы игры игрока (сцена описи: виды в ряд),
 * на общей матовой плашке редакторов (`ModelStage`), камера — общая на всю
 * мастерскую (`stage-camera.js`): ЛКМ — вращение, щелчок ПКМ — полёт,
 * колесо — приближение. Вкладка «Все» показывает все виды рядом, вкладка
 * вида — только его, крупно, с человеком для масштаба.
 *
 * Облик частей — тем же расчётом, что у установщика (`busstops-text.js`):
 * свой цвет, «Без текстуры», узор, картинка, градиент и прозрачность.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFinishTexture } from "../finish/finish-textures.js";
import useWallOverlay from "../model-stage/useWallOverlay.js";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { busStopAimTarget, busStopPartSpec } from "./busstops-aim.js";
import { BUSSTOPS_SCENE_URL, busStopFrameLook, busStopsPlanText, finishSurfaces, partLabel, sceneTypeIndex, targetLabel } from "./busstops-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelOf, labelled } from "../model-stage/hover-label.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Текстура отделки одной поверхности: хук на поверхность, ответ — наверх. */
const FinishProbe = memo(function FinishProbe({ id, settings, onTexture }) {
  const texture = useFinishTexture(settings);
  useEffect(() => onTexture(id, texture), [id, texture, onTexture]);
  return null;
});

/** Текстуры отделки работы по ключу `<вид|all>:<часть>` и их пробы. */
export function useBusStopFinishes(project) {
  const surfaces = useMemo(() => finishSurfaces(project), [project]);
  const [textures, setTextures] = useState({});
  const onTexture = useCallback((id, texture) => setTextures((current) => (current[id] === texture ? current : { ...current, [id]: texture })), []);
  const probes = Object.entries(surfaces)
    .filter(([, settings]) => ["pattern", "image", "gradient"].includes(settings?.mode))
    .map(([id, settings]) => <FinishProbe key={id} id={id} settings={settings} onTexture={onTexture} />);
  return { textures, probes };
}

/**
 * Рамка кадра: все виды рядом или один вид крупно, сбоку и чуть сверху.
 * `thumb` — снимок плитки: без человека, весь вид в кадре.
 */
export function busStopsFrame(target, { thumb = false } = {}) {
  const index = sceneTypeIndex(target);
  return (asset) => {
    const part = index >= 0 ? asset.parts[index] : null;
    /* Снимок плитки садит кадр по коробке сам (`fittedFrame`): zoom 1 — «влезает». */
    const zoom = thumb ? 1 : index >= 0 ? 1.3 : 1.15;
    return {
      bounds: part?.bounds || asset.bounds,
      ground: true,
      person: index >= 0 && !thumb,
      /* Ряд всех видов длиннее плитки в девять раз: на плитке он смотрит наискосок, вдоль — так ряд короче в кадре и виды крупнее. */
      view: { yaw: thumb && index < 0 ? -1 : -0.5, pitch: thumb ? 0.16 : 0.2, zoom },
    };
  };
}

/* `onAim(aim)` — щелчок по части остановки (`busStopAimTarget`); `highlight` — выбранная часть (`busStopPartSpec`) или `null`. */
export default function BusStopsStage({ project, target = "all", onCamera = null, onAim = null, highlight = null, focus = null, wall = null }) {
  useTr();
  const stageRef = useRef(null);
  const { textures, probes } = useBusStopFinishes(project);
  const look = useCallback((index, info) => busStopFrameLook(project, info, { finishes: textures }), [project, textures]);
  /* Гифка постера играет в кадре: пустой объект сцены только даёт кадру ход часов, кадры меняют сами текстуры (`userData.play`). */
  const clock = useMemo(() => new THREE.Group(), []);
  const playing = Object.values(textures).some((texture) => texture?.userData?.play);
  const wallObjects = useWallOverlay(wall);
  const objects = useMemo(() => {
    const own = playing ? [{ object: clock, update: (seconds) => Object.values(textures).forEach((texture) => texture?.userData?.play?.(seconds)) }] : [];
    const all = [...own, ...wallObjects];
    return all.length ? all : null;
  }, [playing, clock, textures, wallObjects]);
  const index = sceneTypeIndex(target);
  const parts = useMemo(() => (index >= 0 ? [index] : null), [index]);
  const frame = useMemo(() => busStopsFrame(target), [target]);
  const label = trFill("{0} в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.", targetLabel(target));
  /* Под курсором подсвечивается та часть того вида, что откроется по щелчку. */
  const aimTarget = useCallback((hit) => {
    const aim = busStopAimTarget(hit);
    /* Подпись у курсора: часть и вид остановки. */
    return aim ? labelled(busStopPartSpec(aim.target, aim.part), labelOf(tr(partLabel(aim.part)), targetLabel(aim.target))) : null;
  }, []);
  const aim = useCallback(
    (hit) => {
      const found = busStopAimTarget(hit);
      if (found) onAim(found, hit);
    },
    [onAim],
  );

  return (
    <div className="fx-stage recolor-stage is-studio busstops-stage">
      {probes}
      <ModelStage loadKit="props"
        ref={stageRef}
        scene={BUSSTOPS_SCENE_URL}
        look={look}
        parts={parts}
        frame={frame}
        frameKey={target}
        objects={objects}
        onCamera={onCamera}
        onAim={onAim ? aim : null}
        aimTarget={aimTarget}
        highlight={focus || highlight}
        label={label}
      />
      {/* Что уедет в игру — строка состояния работы; откуда модели и листы, кадру говорить незачем (обход кадров 29.10.2026). */}
      <StageNote>{busStopsPlanText(project)}</StageNote>
      <StageSheetsNote />
    </div>
  );
}
