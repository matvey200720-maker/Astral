import { useMemo } from "react";
import { createCaptZonesProject, normalizeCaptZonesProject } from "@modovik/climb-contract/recolor/capt-zones";
import { paintCaptZone } from "../capt-zones-editor/capt-zones-art.js";
import { parseCoverState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка «Зон каптов» — зона «Церковь» (Строберри) сверху-сбоку в облике
 * работы, на сетке земли и матовой плашке, как у всех карточек полки:
 * та же шайба, что уедет в игру (форма мода, высота стенки, крыша). Это
 * схема зоны, а не кадр из игры. Пока человек ничего не ставил — облик мода;
 * «Стандарт» — одна земля: зон нет.
 */
const COVER_ZONE = "cercov";
const VIEW = Object.freeze({ yaw: -0.62, pitch: 0.32 });

export default function CaptZonesCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeCaptZonesProject(stored) : createCaptZonesProject();
  }, [state]);
  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      /* Холст прозрачный: под ним матовая плашка `.workshop-cover`. */
      paintCaptZone(context, COVER_ZONE, project, { width, height, view: VIEW });
    },
    [project],
  );
  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
