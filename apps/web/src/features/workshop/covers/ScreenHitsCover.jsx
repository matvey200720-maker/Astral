import { useEffect, useMemo, useState } from "react";
import { applyScreenHitsPreset, createScreenHitsProject, parseScreenHitsProject } from "@modovik/kill-effects/screen-hits.js";
import { paintScreenHits, screenHitsMaskCanvas } from "../screen-hits-editor/screen-hits-painter.js";
import { screenHitPicture } from "../screen-hits-editor/screen-hit-pictures.js";
import { useCoverPending } from "./cover-bake-context.js";
import { parseCoverState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка эффектов попадания на экране — тот же экран, что в кадре
 * редактора: матовая стена и три следа на пике (`screen-hits-painter.js`).
 * Пока своего следа нет — капля игры очерком и её красный цвет; поставил
 * своё — обложка показывает его.
 */
const STOCK_COVER = applyScreenHitsPreset(createScreenHitsProject(), "vanilla");

function coverProject(state) {
  const stored = parseCoverState(state);
  const own = stored?.present || stored;
  return own && typeof own === "object" && own.schema ? parseScreenHitsProject(own) : STOCK_COVER;
}

export default function ScreenHitsCover({ state = null }) {
  const project = useMemo(() => coverProject(state), [state]);
  const [picture, setPicture] = useState(null);
  const asset = project.shape === "own" ? project.own.asset : "";
  /* Своя картинка едет из хранилища — печь обложек ждёт её. */
  const [settled, setSettled] = useState("");
  useCoverPending(Boolean(asset) && settled !== asset);
  useEffect(() => {
    let cancelled = false;
    if (!asset) {
      setPicture(null);
      return undefined;
    }
    screenHitPicture(asset)
      .then((found) => {
        if (!cancelled) setPicture(found);
      })
      .catch(() => {})
      .finally(() => !cancelled && setSettled(asset));
    return () => {
      cancelled = true;
    };
  }, [asset]);
  const mask = useMemo(() => screenHitsMaskCanvas(project, { picture }), [project, picture]);
  const canvasRef = useCoverCanvas((context, { width, height }) => paintScreenHits({ context, width, height, project, mask, matte: true }), [project, mask]);
  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
