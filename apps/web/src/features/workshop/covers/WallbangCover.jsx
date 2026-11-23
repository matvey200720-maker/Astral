import { useEffect, useMemo, useState } from "react";
import {
  createWallbangProject,
  normalizeWallbangProject,
} from "@modovik/climb-contract/wallbang";
import { cachedWallbangRaster } from "../wallbang-editor/useWallbangTiles.js";
import { wallbangTileCanvas } from "../wallbang-editor/wallbang-raster.js";
import { loadWallbangShapes } from "../wallbang-editor/wallbang-shapes.js";
import { parseCoverState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка прострелов — три укрытия разного вида под подсветкой работы:
 * мусорный бак, дом и прицеп фуры, в сумеречном свете, когда подсветка уже
 * светится, а укрытия ещё видны. Формы — настоящие оболочки мода той же
 * растеризацией, что плитки редактора. Пока человек ничего не ставил —
 * облик мода: синие полупрозрачные оболочки.
 *
 * Фон — матовая плашка обложки, как у всех карточек полки. Раньше под
 * укрытиями стояли сумеречное небо и земля, и карточка «Прострелов» одна
 * на полке горела радугой. Небо осталось только в самом редакторе: там это
 * время суток сцены, а не оформление карточки. Чтобы укрытия не висели в
 * пустоте, под каждым лежит мягкая тень.
 *
 * Скрытое в работе укрытие на обложке всё равно показано подсвеченным:
 * обложка говорит, как выглядит подсветка, а не перечисляет укрытия.
 */
const COVER_OBJECTS = Object.freeze([
  Object.freeze({ id: "dumpster", share: 0.26, lift: 0 }),
  Object.freeze({ id: "house", share: 0.44, lift: 0.04 }),
  Object.freeze({ id: "trailer", share: 0.3, lift: 0 }),
]);
const SCENE = "dusk";
/* Где на плитке стоят укрытия: верх ячейки и её высота — доли высоты. */
const CELL_TOP = 0.1;
const CELL_HEIGHT = 0.78;

/* Тень под укрытием: тёмный эллипс по ширине ячейки, мягко к краям. */
function paintShadow(context, left, width, floor, height) {
  const radiusX = width * 0.42;
  const radiusY = Math.max(2, height * 0.035);
  const centreX = left + width / 2;
  context.save();
  context.translate(centreX, floor);
  context.scale(1, radiusY / radiusX);
  const shade = context.createRadialGradient(0, 0, 0, 0, 0, radiusX);
  shade.addColorStop(0, "rgba(0, 0, 0, 0.55)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = shade;
  context.beginPath();
  context.arc(0, 0, radiusX, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function coverProject(state) {
  const stored = parseCoverState(state);
  const project = stored
    ? normalizeWallbangProject(stored)
    : createWallbangProject();
  return normalizeWallbangProject({
    ...project,
    objects: Object.fromEntries(
      Object.entries(project.objects).map(([id, item]) => [
        id,
        { ...item, visible: true },
      ]),
    ),
  });
}

export default function WallbangCover({ state = null }) {
  const project = useMemo(() => coverProject(state), [state]);
  const [shapes, setShapes] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadWallbangShapes(COVER_OBJECTS.map((item) => item.id))
      .then((loaded) => {
        if (!cancelled) setShapes(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      /* Холст прозрачный: под ним матовая плашка `.workshop-cover`. */
      if (!shapes) return false;
      const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
      let left = width * 0.03;
      for (const item of COVER_OBJECTS) {
        const shape = shapes.get(item.id);
        const cellWidth = width * 0.94 * item.share;
        const cellHeight = height * CELL_HEIGHT;
        const top = height * (CELL_TOP - item.lift);
        if (shape) {
          const raster = cachedWallbangRaster(shape, item.id, {
            width: Math.round(cellWidth * ratio),
            height: Math.round(cellHeight * ratio),
            view: { yaw: -0.55, pitch: 0.3 },
          });
          const floor = top + (raster.floor ?? 1) * cellHeight;
          paintShadow(context, left, cellWidth, floor, height);
          const tile = wallbangTileCanvas(raster, project, item.id, SCENE);
          if (tile) context.drawImage(tile, left, top, cellWidth, cellHeight);
        }
        left += cellWidth;
      }
    },
    [project, shapes],
  );

  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
