import { useEffect, useMemo, useState } from "react";
import {
  ZONES_INVENTORY,
  createZonesProject,
  normalizeZonesProject,
} from "@modovik/climb-contract/recolor/zones";
import { paintSceneParts } from "../model-stage/mesh-painter.js";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { findZoneItem, zoneFrameLook } from "../zones-editor/zones-text.js";
import { parseCoverState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка запретных зон — многоуровневая парковка в Хавике под оболочкой
 * мода в облике работы, сверху-сбоку, на матовой плашке, как у всех
 * карточек полки. Форма — настоящая оболочка из мода; под ней сетка земли:
 * сквозь полупрозрачную зону она видна, сквозь сплошную — нет. Пока человек
 * ничего не ставил — облик мода: красная полупрозрачная.
 *
 * Невидимые зоны на обложке не рисуются вовсе — остаётся одна земля: так
 * обложка честно говорит «зон не видно».
 */
const COVER_ZONE = "gucci_hw1_09_mscp";
const VIEW = Object.freeze({ yaw: -0.7, pitch: 0.62 });

export default function ZonesCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeZonesProject(stored) : createZonesProject();
  }, [state]);
  const [asset, setAsset] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadSceneAsset(ZONES_INVENTORY.scene.url)
      .then((loaded) => {
        if (!cancelled) setAsset(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      /* Холст прозрачный: под ним матовая плашка `.workshop-cover`. */
      if (!asset) return false;
      const zone = findZoneItem(COVER_ZONE);
      paintSceneParts(context, asset, {
        parts: [zone.id],
        look: () => zoneFrameLook(project, zone),
        width,
        height,
        view: VIEW,
        margin: 0.12,
        grid: 6,
      });
    },
    [project, asset],
  );

  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
