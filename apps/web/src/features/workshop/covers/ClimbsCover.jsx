import { useMemo } from "react";
import {
  CLIMB_SLOTS,
  normalizeClimbModule,
  stripClimbImages,
} from "@modovik/climb-contract";
import {
  climbMarkerCanvas,
  climbSlotRows,
} from "../climb-editor/climb-render.js";
import { useOwnFontReady } from "../emblem/own-font.js";
import { readStudioModule } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка залазов — весь набор меток той же текстурой, что уходит в игру:
 * стрелка, «STAY HERE», «JUMP SPACE», «1 POV» и «3 POV», «RIGHT CLICK»,
 * машина, удар и «CLICK - Q». Стандартная обложка — метки мода, с которых
 * редактор начинает; своя работа показывается своими видами и цветами.
 * Принесённые картинки на обложку не попадают — они живут в хранилище
 * проекта, и вместо них стоит метка мода. Пустой щит мода (`teamneed` «как
 * в моде») на обложке не занимает клетку: на ней было бы пусто.
 */
const COVER_TEXTURE = 160;

export default function ClimbsCover({ projectId = "", state = null }) {
  const design = useMemo(
    () => normalizeClimbModule(readStudioModule(projectId, "climbs", state)).design,
    [projectId, state],
  );
  /* Свой шрифт меток открывается из хранилища окна не сразу — обложка перерисуется им. */
  const fontReady = useOwnFontReady(design.style.fontAsset);
  const markers = useMemo(() => {
    const plain = stripClimbImages(design);
    const shown = CLIMB_SLOTS.filter(
      (slot) =>
        plain.markers[slot.id].enabled &&
        !(slot.blank && plain.markers[slot.id].variant === "original"),
    );
    return shown.map((slot) => ({
      slot,
      canvas: climbMarkerCanvas(plain, slot.id, {
        size: COVER_TEXTURE * slot.aspect,
      }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, fontReady]);

  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      if (!markers.length) return;
      /* Очень широкая плитка — одной строкой, остальные — двумя. */
      const slots = climbSlotRows(
        markers.map((item) => item.slot),
        width / height >= 3.5 || markers.length <= 4 ? 1 : 2,
      );
      const rows = slots.map((row) =>
        row.map((slot) => markers.find((item) => item.slot === slot)),
      );
      const rowHeight = (height * 0.86) / rows.length;
      rows.forEach((row, rowIndex) => {
        const units = row.reduce((sum, item) => sum + item.slot.aspect, 0);
        const cell = Math.min(rowHeight, (width * 0.92) / units);
        let left = (width - cell * units) / 2;
        const top =
          height * 0.07 + rowIndex * rowHeight + (rowHeight - cell) / 2;
        for (const { slot, canvas } of row) {
          const cellWidth = cell * slot.aspect;
          if (canvas) {
            /* Зазор между метками: иначе надписи соседних клеток читаются одним словом. */
            const drawWidth = cellWidth * 0.86;
            const drawHeight = drawWidth / (canvas.width / canvas.height);
            context.drawImage(canvas, left + (cellWidth - drawWidth) / 2, top + (cell - drawHeight) / 2, drawWidth, drawHeight);
          }
          left += cellWidth;
        }
      });
    },
    [markers],
  );

  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
