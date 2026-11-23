// Сцена большой карты: холст с запасом, камера, выбор, рисование, правка надписей, подсказки.
// Здесь только сборка: каждая возможность живёт в своём файле папки world-map-stage/.
import { createElement, useRef, useCallback, useMemo } from "react";
import { tr, useTr } from "../../../locales/ui.js";
import MapScene from "./MapScene.jsx";
import { useTextAdvance } from "./world-map-text-measure.js";
import { viewBoxOf } from "./world-map-stage/frame-math.js";
import { majesticGhosts, meshGhosts } from "./world-map-stage/marks-extra.js";
import { pressTypeGrip } from "./world-map-stage/modes-edit.js";
import { pointerHandlers } from "./world-map-stage/pointer-router.js";
import { handlesOf } from "./world-map-stage/select-rules.js";
import { buildEnv, hitClassOf, withDefaults } from "./world-map-stage/stage-env.js";
import { collectMarks } from "./world-map-stage/stage-marks.js";
import { Tooltip, ZoomPanel, busyBadge, crowdingWarning, dropHint } from "./world-map-stage/stage-panels.js";
import { useStageGeometry, useStageWindow } from "./world-map-stage/stage-space.js";
import { useCamera } from "./world-map-stage/use-camera.js";
import { grabPointer, usePointerState } from "./world-map-stage/use-pointer-state.js";
import { useSceneMotion } from "./world-map-stage/use-scene-motion.js";
import { useStageHover } from "./world-map-stage/use-stage-hover.js";
import { useTextTools } from "./world-map-stage/use-text-tools.js";

export { canvasBoxOf } from "./world-map-stage/frame-math.js";

const h = createElement;

export default function WorldMapStage(props) {
  const p = withDefaults(props);
  const { scene, config, tool, selection, shape, draft, onDropFiles } = p;
  useTr();

  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const textAdvance = useTextAdvance();
  const win = useStageWindow(stageRef);
  const geo = useStageGeometry({ scene, atlas: p.atlas, memoryId: p.memoryId, svgRef, win });
  const camera = useCamera({
    scene,
    win,
    geo,
    svgRef,
    stageRef,
    callbacks: { onViewChange: p.onViewChange, onZoomChange: p.onZoomChange },
    zoomCommand: p.zoomCommand,
    focus: p.focus,
    selection,
  });
  const pointer = usePointerState();
  const hideRing = useCallback(() => {
    pointer.nodes.current.ring?.setAttribute("visibility", "hidden");
  }, [pointer.nodes]);
  const hovering = useStageHover({
    tool,
    shape,
    draft,
    setAim: pointer.setAim,
    setStretch: pointer.setStretch,
    hideRing,
    dropEnabled: Boolean(onDropFiles),
  });

  const env = buildEnv({ props: p, geo, camera, pointer, win, stageRef, textAdvance });
  const text = useTextTools({ env });
  const motion = useSceneMotion({
    scene,
    zoom: geo.frame.zoom,
    hold: camera.ctl.holdMs,
    hidden: text.hidden,
  });

  // Призраки подписей донора и меток вики пересчитываются только со сменой инструмента и разделов
  const { markers, majestic } = config;
  const ghosts = {
    mesh: useMemo(() => (tool === "labels" ? meshGhosts({ markers }) : []), [tool, markers]),
    majestic: useMemo(
      () => (tool === "majestic" ? majesticGhosts({ majestic }) : []),
      [tool, majestic],
    ),
  };

  // Ручка поля печати: холст забирает указатель, дальше тянут обработчики холста
  const beginGrip = (event, grip) => {
    if (!p.textEdit?.emblem || !grabPointer(svgRef.current, event.pointerId)) return;
    hovering.reset();
    pressTypeGrip(env, grip, event);
  };

  const marks = collectMarks({
    p,
    env,
    geo,
    handles: handlesOf(env),
    motion,
    hovering,
    pointer,
    text,
    ghosts,
  });

  const canvas = h(
    MapScene,
    {
      ref: svgRef,
      scene: motion.shown,
      backdrop: p.backdrop,
      frame: geo.canvas,
      clip: geo.canvas,
      fresh: motion.appear,
      leaving: motion.leaving,
      hit: hitClassOf({
        tool,
        shape,
        dragging: pointer.dragging,
        space: camera.space,
        cursor: pointer.cursor,
      }),
      hitProps: { "data-pannable": geo.pannable ? "yes" : "no" },
      className: pointer.dragging ? "wmc-canvas is-dragging" : "wmc-canvas",
      style: geo.box,
      viewBox: viewBoxOf(geo.canvas),
      ...pointerHandlers(env, hovering, text),
    },
    ...marks,
  );

  const drop = hovering.dropHandlers;
  const children = [
    canvas,
    busyBadge(p.busy),
    hovering.hover && h(Tooltip, { hover: hovering.hover, config, win, tip: hovering.tip }),
    text.labelField(),
    text.boardField(),
    text.typeField(beginGrip),
    hovering.dropping ? dropHint() : null,
    h(ZoomPanel, {
      zoom: geo.view.zoom,
      ctl: camera.ctl,
      gamePreview: p.gamePreview,
      onGamePreview: p.onGamePreview,
    }),
    p.overlay,
    crowdingWarning(p.crowding, p.onFixCrowding),
  ];

  return h(
    "div",
    {
      ref: stageRef,
      className: p.className ? `wmc-stage ${p.className}` : "wmc-stage",
      "data-source": scene.source,
      tabIndex: 0,
      "aria-label": tr(
        "Карта: колесо и щипок — приближение, два пальца и стрелки — сдвиг, «+» и «−» — масштаб",
      ),
      "data-dropping": hovering.dropping ? "" : undefined,
      onKeyDown: camera.onKeyDown,
      onDragOver: drop.onDragOver,
      onDragLeave: drop.onDragLeave,
      onDrop: (event) => drop.onDrop(event, env),
    },
    ...children,
  );
}
