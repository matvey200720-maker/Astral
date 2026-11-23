/*
 * Готовые залазы — сеткой в панели инструмента «Шаблоны» (мастерская «как
 * в Photoshop», 03.10.2026), как готовые прицелы и виды мест. Полка там —
 * всё содержимое панели, поэтому без переключателя: видна сразу.
 *
 * Плитка показывает весь набор: десять меток той же текстурой, что уедет в
 * игру, с надписями и картинками человека — набор меняет облик, а не то,
 * что человек написал и принёс. Выбранной плитки нет: набор — отправная
 * точка, а не состояние. Поправил цвет — это уже свой набор.
 */

import { memo, useMemo } from "react";
import { CLIMB_PRESETS, applyClimbPreset } from "@modovik/climb-contract";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { context2d } from "../../../components/desktop/workshop/canvas-surface.js";
import { climbMarkerCanvas, climbSlotRows } from "./climb-render.js";
import { tr, useTr } from "../../../locales/ui.js";

const TILE = 64;
const ROWS = climbSlotRows();

/* Десять меток двумя строками на одном холсте: широкие — шире клетки. */
function presetStrip(design, pictures) {
  if (typeof document === "undefined") return "";
  const units = (row) => row.reduce((sum, slot) => sum + slot.aspect, 0);
  const canvas = document.createElement("canvas");
  canvas.width = TILE * Math.max(...ROWS.map(units));
  canvas.height = TILE * ROWS.length;
  const context = context2d(canvas);
  if (!context) return "";
  ROWS.forEach((row, index) => {
    let left = (canvas.width - TILE * units(row)) / 2;
    for (const slot of row) {
      const marker = design.markers[slot.id].enabled
        ? climbMarkerCanvas(design, slot.id, {
            size: TILE * slot.aspect,
            picture: pictures[slot.id] || null,
          })
        : null;
      if (marker)
        context.drawImage(
          marker,
          left,
          TILE * index + (TILE - marker.height) / 2,
          marker.width,
          marker.height,
        );
      left += TILE * slot.aspect;
    }
  });
  return canvas.toDataURL?.() || "";
}

function ClimbPresets({ design, pictures, onApply }) {
  useTr();
  const strips = useMemo(
    () =>
      CLIMB_PRESETS.map((preset) => ({
        preset,
        href: presetStrip(applyClimbPreset(design, preset), pictures),
      })),
    [design, pictures],
  );
  return (
    <PresetShelf
      title={tr("Готовые залазы")}
      label={tr("Готовые наборы меток залазов")}
     
      className="climb-presets"
      collapsible={false}
    >
      {strips.map(({ preset, href }) => (
        <ChoiceTile
          key={preset.id}
          className="climb-preset"
          media={href ? <img src={href} alt="" /> : <i aria-hidden="true" />}
          title={preset.label}
          tooltip={preset.description}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(ClimbPresets);
