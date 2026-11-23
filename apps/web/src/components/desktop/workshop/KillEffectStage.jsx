/*
 * Кадр предпросмотра килл-эффекта.
 *
 * Сцена — матовая стена Astral, та же плашка, что под обложкой раздела
 * (владелец, 25.09.2026). До неё здесь стояли семь фотографий и трёхмерных
 * сцен, потом кирпичная стена со следом убийства — и каждый раз взгляд
 * уходил на декорацию. На ровной стене видно ровно то, что делает эффект:
 * какого цвета вспышка, где она ложится и сколько держится.
 *
 * Сама вспышка живёт в `kill-effect-painter.js`. Проход обязан остаться одним
 * на всех — большой кадр, плитки шаблонов и обложка: карточка, нарисованная
 * своим проходом, показывала бы не тот эффект, который человек увидит в
 * кадре, и выбор шаблона снова стал бы выбором вслепую.
 */

import { useEffect, useRef } from "react";
import { killEffectFrame } from "@modovik/kill-effects";
import { paintKillEffect } from "./kill-effect-painter.js";
import { killMarkerPaintKey, paintKillMarker } from "./kill-marker-painter.js";
import { tr, useTr } from "../../../locales/ui.js";

/**
 * Кадр на момент `elapsed` — или на момент из хранилища `playhead`
 * (`KillEffectPlayback.jsx`).
 *
 * С хранилищем кадр рисуется напрямую, по подписке: проигрывание идёт
 * шестьдесят кадров в секунду, и проводить каждый через перерисовку React
 * значило бы перерисовывать с ним весь редактор. Проект и «как было»
 * приходят пропсами — от них кадр перерисовывается на том же моменте.
 */
export default function KillEffectStage({
  project,
  elapsed = 0,
  playhead = null,
  bypass = false,
  /* Кадры картинки знака на килле (`kill-marker-frames.js`): знак рисуется
     поверх вспышки в точке прицела, как в игре. */
  markerSequence = null,
  className = "",
  /* Живой кадр вместо матовой стены: источник снимков 3D-сцены боя
     (`features/workshop/combat-stage/scene-source.js`). Эффект ложится на него
     тем же проходом, что и на стену; подпись холста — своя. */
  scene = null,
  label = "",
}) {
  useTr();
  const canvasRef = useRef(null);
  /* Контекст берётся один раз: холст тот же всё время жизни кадра, а
     `getContext` в среде без canvas ещё и шумит в журнал на каждом вызове. */
  const contextRef = useRef(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    if (contextRef.current === undefined) {
      contextRef.current = canvas.getContext("2d") || null;
    }
    const context = contextRef.current;
    if (!context) return undefined;

    /*
     * Размер кадра — от наблюдателя, а не чтением раскладки на каждом кадре:
     * `clientWidth` посреди проигрывания заставлял браузер досчитывать
     * раскладку всей страницы, если в ней что-то сдвинулось.
     */
    let size = null;
    const measure = () => ({
      width: canvas.clientWidth || 960,
      height: canvas.clientHeight || 540,
    });
    /*
     * Тот же кадр второй раз не рисуется. Полка вспышки (сила 1) и стена
     * после неё — это десятки одинаковых кадров подряд, а каждый — стена,
     * кайма, слой эффекта и размытие во весь холст. Зерно и строки плёнки
     * движутся сами, у них кадр всегда другой.
     */
    let painted = "";
    const paint = (moment) => {
      size ??= measure();
      const { width, height } = size;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const frame = bypass ? { strength: 0 } : killEffectFrame(project, moment);
      const moving = frame.grain || frame.scanlines;
      const marker = bypass ? null : project.marker;
      const sceneCanvas = scene?.ready() ? scene.canvas : null;
      const key = `${width}x${height}@${ratio}:${JSON.stringify(frame)}${
        moving ? `:${Math.round(moment)}` : ""
      }|${killMarkerPaintKey(marker, markerSequence, moment)}|${sceneCanvas ? scene.version() : 0}`;
      if (key === painted) return;
      painted = key;
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintKillEffect({ context, width, height, frame, elapsed: moment, scene: sceneCanvas });
      paintKillMarker({
        context,
        width,
        height,
        marker,
        sequence: markerSequence,
        elapsed: moment,
      });
    };

    const current = () => (playhead ? playhead.get() : elapsed);
    paint(current());
    const unsubscribePlayhead = playhead ? playhead.subscribe(paint) : () => {};
    /* Новый кадр сцены — новая картинка под эффектом. */
    const unsubscribeScene = scene ? scene.subscribe(() => paint(current())) : () => {};
    const unsubscribe = () => {
      unsubscribePlayhead();
      unsubscribeScene();
    };
    /* Кадр живёт в колонке, которая меняет размер вместе с окном: без
       перерисовки по размеру стоящий кадр растягивался бы старой картинкой. */
    if (typeof ResizeObserver !== "function") return unsubscribe;
    const observer = new ResizeObserver(() => {
      size = measure();
      paint(current());
    });
    observer.observe(canvas);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [project, elapsed, playhead, bypass, markerSequence, scene]);

  return (
    <canvas
      ref={canvasRef}
      className={`kill-effect-stage ${className}`.trim()}
      role="img"
      aria-label={label || tr("Предпросмотр килл-эффекта на матовой стене")}
    />
  );
}
