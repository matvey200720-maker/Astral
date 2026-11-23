/*
 * Готовые прострелы — сеткой в панели инструмента «Шаблоны» (мастерская
 * «как в Photoshop»): без переключателя, видны сразу.
 *
 * Плитка показывает набор на трёх укрытиях разного вида — мусорном баке,
 * кондиционере на крыше и доме, — той же растеризацией, что плитки сцены.
 * Клетки квадратные: в панели две плитки в ряд, и узкая лента из трёх
 * укрытий сжалась бы в полоску. Выбранной плитки нет: набор — отправная
 * точка, а не состояние. Поправил цвет — это уже свой набор. Видимость
 * укрытий набор не трогает.
 */

import { memo, useMemo } from "react";
import {
  WALLBANG_PRESETS,
  applyWallbangPreset,
  normalizeWallbangProject,
} from "@modovik/climb-contract/wallbang";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { useWallbangRasters } from "./useWallbangTiles.js";
import { paintWallbangTile } from "./wallbang-raster.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Укрытия плитки: низкое, на крыше и целый дом — у набора «по видам» все
   три разного цвета. */
const PRESET_OBJECTS = Object.freeze(["dumpster", "roof_aircon", "house"]);
const CELL = Object.freeze({ width: 96, height: 96 });

/* Всё видно: плитка показывает облик набора, а не то, что человек скрыл. */
function presetProject(project, preset) {
  const applied = applyWallbangPreset(project, preset.id);
  const objects = Object.fromEntries(
    Object.entries(applied.objects).map(([id, item]) => [
      id,
      { ...item, visible: true },
    ]),
  );
  return normalizeWallbangProject({ ...applied, objects });
}

function presetStrip(rasters, project) {
  if (typeof document === "undefined" || rasters.size < PRESET_OBJECTS.length)
    return "";
  const canvas = document.createElement("canvas");
  canvas.width = CELL.width * PRESET_OBJECTS.length;
  canvas.height = CELL.height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  PRESET_OBJECTS.forEach((id, index) => {
    const raster = rasters.get(id);
    const image = context.createImageData(raster.width, raster.height);
    paintWallbangTile(raster, project, id, "day", image);
    context.putImageData(image, index * CELL.width, 0);
  });
  return canvas.toDataURL?.() || "";
}

function WallbangPresets({ project, shapes, onApply }) {
  useTr();
  const rasters = useWallbangRasters(shapes, PRESET_OBJECTS, CELL);
  const strips = useMemo(
    () =>
      WALLBANG_PRESETS.map((preset) => ({
        preset,
        href: presetStrip(rasters, presetProject(project, preset)),
      })),
    [rasters, project],
  );
  return (
    <PresetShelf
      title={tr("Готовые прострелы")}
      label={tr("Готовые наборы подсветки прострелов")}
     
      className="wallbang-presets"
      collapsible={false}
    >
      {strips.map(({ preset, href }) => (
        <ChoiceTile
          key={preset.id}
          className="wallbang-preset"
          media={href ? <img src={href} alt="" /> : <i aria-hidden="true" />}
          title={preset.label}
          tooltip={preset.description}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(WallbangPresets);
