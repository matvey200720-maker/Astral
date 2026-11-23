/*
 * Мышь над стволом у инструмента «Украшения» (задача 13 ТЗ 10.10.2026).
 *
 * Как у наклейки: украшение в руке ходит за курсором полупрозрачным, щелчок
 * ставит его в эту точку модели (с Shift — и оставляет в руке), колесо
 * крутит, Shift с колесом — размер. Без украшения в руке щелчок по
 * украшению выбирает его, и его можно тащить по стволу: пока тащат, кадр
 * показывает новое место, на отпускании оно ложится в проект одним шагом
 * отмены.
 *
 * Место — в осях самой модели (`hit.model`): ровно туда хост поставит
 * треугольники в модели игры.
 */

import { useCallback, useEffect, useRef } from "react";
import { createDecoration, decorationKind } from "@modovik/gun-studio";
import { markWheel } from "../../../ui/wheel-mark.js";

const ROTATION_STEP = 15;

export function useDecorationPointer({
  scene,
  canvasRef,
  loading,
  active,
  armed,
  armedImage = null,
  pose,
  onPose,
  decorations,
  onShow,
  onPlace,
  onSelect,
  onMove,
}) {
  const drag = useRef(null);
  const latest = useRef({});
  latest.current = { armed, armedImage, pose, decorations };

  /* Украшение в руке в точке под курсором. */
  const draftAt = useCallback((hit, override = null) => {
    const { armed: inHand } = latest.current;
    const current = override || latest.current.pose;
    if (!inHand || !hit?.model) return null;
    const kind = decorationKind(inHand.kind);
    return createDecoration({
      ...inHand,
      /* Номер «0» не сдвигает счётчик номеров договора: настоящие украшения
         начинаются с первого. */
      id: "deco-0",
      anchor: hit.model.point,
      normal: hit.model.normal,
      size: current.size ?? kind.size.standard,
      rotation: current.rotation ?? 0,
    });
  }, []);

  const previewAt = useCallback(
    (clientX, clientY, override = null) => {
      const hit = scene.current?.pickSurface(clientX, clientY) || null;
      scene.current?.previewDecoration?.(draftAt(hit, override), latest.current.armedImage);
    },
    [scene, draftAt],
  );

  function onPointerDown(event) {
    if (!active || event.button !== 0 || loading) return;
    if (armed) {
      const hit = scene.current?.pickSurface(event.clientX, event.clientY);
      if (!hit) return;
      event.preventDefault();
      const draft = draftAt(hit);
      if (draft) onPlace?.(draft, { keepInHand: event.shiftKey });
      return;
    }
    const id = scene.current?.pickDecoration?.(event.clientX, event.clientY) || "";
    onSelect?.(id);
    if (!id) return;
    event.preventDefault();
    drag.current = { id, moved: null };
    scene.current?.setControlsEnabled(false);
    try {
      canvasRef.current?.setPointerCapture(event.pointerId);
    } catch {
      /* без захвата — тоже тащится, пока курсор над стволом */
    }
  }

  function onPointerMove(event) {
    if (!active) return;
    if (drag.current) {
      const hit = scene.current?.pickSurface(event.clientX, event.clientY);
      if (!hit?.model) return;
      const moved = { anchor: hit.model.point, normal: hit.model.normal };
      drag.current.moved = moved;
      onShow?.(
        latest.current.decorations.map((item) => (item.id === drag.current.id ? { ...item, ...moved } : item)),
      );
      return;
    }
    if (armed) previewAt(event.clientX, event.clientY);
  }

  function onPointerUp() {
    if (!drag.current) return;
    const { id, moved } = drag.current;
    drag.current = null;
    scene.current?.setControlsEnabled(true);
    if (moved) onMove?.(id, moved);
  }

  function onPointerLeave() {
    if (active && armed && !drag.current) scene.current?.previewDecoration?.(null);
  }

  /* Колесо у украшения в руке: поворот, с Shift — размер. Зум камеры на это
     время выключен, как у наклейки. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = scene.current;
    const holding = active && Boolean(armed);
    stage?.setZoomEnabled?.(!holding);
    if (!canvas || !holding) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const direction = Math.sign(event.deltaY || event.deltaX);
      if (!direction) return;
      const { armed: inHand, pose: current } = latest.current;
      const kind = decorationKind(inHand?.kind);
      let patch;
      if (event.shiftKey) {
        const size = (current.size ?? kind.size.standard) - direction * 0.25;
        patch = { size: Math.round(Math.min(kind.size.max, Math.max(kind.size.min, size)) * 100) / 100 };
      } else {
        let rotation = (current.rotation ?? 0) - direction * ROTATION_STEP;
        if (rotation > 180) rotation -= 360;
        if (rotation < -180) rotation += 360;
        patch = { rotation };
      }
      onPose?.(patch);
      /* Кадр — сразу в новой позе: состояние окна догонит его следующей
         отрисовкой. */
      previewAt(event.clientX, event.clientY, { ...current, ...patch });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    /* Колесо над кадром, пока деталь в руке, — её поворот и размер, а не прокрутка страницы: метка для правила `scroll`. */
    const unmarkWheel = markWheel(canvas);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      unmarkWheel();
      stage?.setZoomEnabled?.(true);
    };
  }, [active, armed, canvasRef, scene, onPose, previewAt]);

  /* Украшение ушло из руки — полупрозрачное уходит из кадра. */
  useEffect(() => {
    if (!armed || !active) scene.current?.previewDecoration?.(null);
  }, [armed, active, scene]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onPointerLeave,
  };
}
