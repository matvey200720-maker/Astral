/*
 * Кадр эффектов попадания на экране: матовая стена и три попадания с
 * разных сторон по кругу — след нарастает, держится и гаснет теми же
 * числами, что уйдут в игру (`screen-hits-painter.js`). Над кадром — вид:
 * от третьего лица или от первого (у игры у него свои числа, след крупнее).
 *
 * Кадр рисуется общим циклом сцен (`stage-loop.js`): за закрытыми воротами
 * (окно спрятано, сцена прокручена) кадров не просят. Первый кадр — сразу и
 * на пике: так сцена не пустая и там, где кадры не идут.
 */

import { useMemo, useRef } from "react";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { context2d, previewRatio } from "../../../components/desktop/workshop/canvas-surface.js";
import { useStageLoop } from "../../../components/desktop/workshop/stage-loop.js";
import { paintScreenHits, screenHitsLoop, screenHitsMaskCanvas } from "./screen-hits-painter.js";
import { tr, useTr } from "../../../locales/ui.js";

export const SCREEN_HITS_VIEW_OPTIONS = Object.freeze([
  Object.freeze({ value: "third", label: "От третьего лица" }),
  Object.freeze({ value: "first", label: "От первого лица" }),
]);

export default function ScreenHitsStage({
  project,
  drop = null,
  picture = null,
  view = "third",
  onView,
  /* Выключатель «Объёмный / Плоский» — есть, когда игра подключена и сцена боя может подняться. */
  modeControl = null,
}) {
  useTr();
  const canvasRef = useRef(null);
  const settingsRef = useRef(null);
  const mask = useMemo(
    () => screenHitsMaskCanvas(project, { drop, picture }),
    // Маска зависит только от картинки следа, а не от цвета и чисел.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.shape, project.count, project.own.asset, project.own.invert, drop, picture],
  );
  settingsRef.current = { project, mask, view };

  useStageLoop(
    canvasRef,
    (canvas) => {
      const context = context2d(canvas);
      if (!context) return null;
      const draw = (moment) => {
        const { project: current, mask: currentMask, view: currentView } = settingsRef.current;
        const width = canvas.clientWidth || 960;
        const height = canvas.clientHeight || 540;
        const ratio = previewRatio();
        const w = Math.round(width * ratio);
        const h = Math.round(height * ratio);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        paintScreenHits({ context, width, height, project: current, mask: currentMask, moment, view: currentView, timeline: true });
      };
      /* Первый кадр — на пике, без цикла. */
      draw(null);
      const started = typeof performance !== "undefined" ? performance.now() : 0;
      return {
        maxFps: 30,
        frame: (time) => {
          const loop = screenHitsLoop(settingsRef.current.project);
          draw((time - started) % loop);
          return 0;
        },
      };
    },
    [],
  );

  return (
    <div className="fx-stage recolor-stage screen-hits-stage is-studio">
      <div className="model-stage-frame screen-hits-frame">
        <canvas ref={canvasRef} role="img" aria-label={tr("Экран с тремя попаданиями: след в облике работы")} data-screen-hits-shape={project.shape} />
      </div>
      <StageBar>
        {modeControl}
        <SegmentedControl label={tr("Вид в игре")} size="sm" options={SCREEN_HITS_VIEW_OPTIONS} value={view} onChange={onView} />
      </StageBar>
      <StageNote>{tr("В кадре три попадания с разных сторон; в игре след встаёт со стороны каждого выстрела по вам.")}</StageNote>
    </div>
  );
}
