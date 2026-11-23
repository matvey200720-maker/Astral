import { useEffect, useMemo, useState } from "react";
import { GROUP_MARKERS, findGroupMarker } from "@modovik/minimap-contract/group-markers";
import { composeMark, loadPngImage } from "../group-markers-editor/group-markers-art.js";
import { groupMarkerPicture } from "../group-markers-editor/group-markers-pictures.js";
import { parseGroupMarkersProject } from "../group-markers-editor/group-markers-project.js";
import { readGroupMarkerStock } from "../group-markers-editor/group-markers-stock.js";
import { distanceLabel } from "../group-markers-editor/group-markers-view.js";
import { useCoverPending } from "./cover-bake-context.js";
import { parseCoverState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка «Групповых меток» (задача 21 ТЗ 18.10.2026, вечер) — одна метка на чёрном и подпись расстояния
 * под ней, как над миром в игре. Метка — первая из правленных или «Внимание», пока своих нет; кружков по
 * бокам нет (владелец, 19.10.2026). Рисунок — лист из вашей игры, запомненный редактором
 * (`group-markers-stock.js`); игру редактор ещё не читал — метка нарисована очерком Astral. Фон — чёрный,
 * как у всех обложек.
 */
const FILL = Object.freeze(["warning"]);
const EDGE = 128;

function coverProject(state) {
  const stored = parseCoverState(state);
  return stored && typeof stored === "object" && stored.schema ? parseGroupMarkersProject(stored) : parseGroupMarkersProject({});
}

/* Метка обложки: первая из правленных, иначе «Внимание». Накладки радара — не метки над миром, их нет. */
export function coverMarks(project) {
  const picked = GROUP_MARKERS.filter((item) => project.marks[item.id] && !item.overlay).map((item) => item.id);
  for (const id of FILL) if (!picked.includes(id)) picked.push(id);
  return picked.slice(0, 1).map((id) => findGroupMarker(id));
}

export default function GroupMarkersCover({ state = null }) {
  const project = useMemo(() => coverProject(state), [state]);
  const marks = useMemo(() => coverMarks(project), [project]);
  const [images, setImages] = useState(null);
  /* Листов из игры ещё нет — обложка живая, очерком: печь не запекает её на три дня, пока игру не прочли. */
  useCoverPending(images === null || ![...images.values()].some((found) => found.stockImage));
  useEffect(() => {
    let cancelled = false;
    const stock = readGroupMarkerStock();
    Promise.all(
      marks.map(async (item) => {
        const edit = project.marks[item.id] || null;
        const [stockImage, picture] = await Promise.all([loadPngImage(stock[item.id]), edit?.asset ? groupMarkerPicture(edit.asset).catch(() => null) : null]);
        return [item.id, { stockImage, picture }];
      }),
    ).then((loaded) => {
      if (!cancelled) setImages(new Map(loaded));
    });
    return () => {
      cancelled = true;
    };
  }, [marks, project]);
  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      if (!images) return false;
      context.fillStyle = "#000000";
      context.fillRect(0, 0, width, height);
      const layout = [{ item: marks[0], edge: 0.44, x: 0.5, y: 0.42, alpha: 1 }];
      for (const { item, edge, x, y, alpha } of layout) {
        if (!item) continue;
        const own = project.marks[item.id] || null;
        const found = images.get(item.id);
        const { canvas } = composeMark({ mark: item, edit: own, stockImage: found?.stockImage || null, picture: found?.picture || null, edge: EDGE });
        if (!canvas) continue;
        const size = edge * Math.min(width, height * 1.6);
        const scale = size / Math.max(canvas.width, canvas.height);
        context.globalAlpha = alpha;
        context.imageSmoothingEnabled = false;
        context.drawImage(canvas, width * x - (canvas.width * scale) / 2, height * y - (canvas.height * scale) / 2, canvas.width * scale, canvas.height * scale);
      }
      context.globalAlpha = 1;
      const fontSize = Math.max(11, Math.round(height * 0.09));
      context.font = `600 ${fontSize}px ${typeof getComputedStyle === "function" ? getComputedStyle(document.body).fontFamily || "sans-serif" : "sans-serif"}`;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.lineJoin = "round";
      context.lineWidth = Math.max(2, fontSize * 0.2);
      context.strokeStyle = "rgba(0, 0, 0, 0.9)";
      const label = distanceLabel(62);
      const labelY = height * 0.42 + 0.22 * Math.min(width, height * 1.6) + fontSize * 0.2;
      context.strokeText(label, width / 2, labelY);
      context.fillStyle = "#ffffff";
      context.fillText(label, width / 2, labelY);
      return true;
    },
    [images, marks, project],
  );
  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
