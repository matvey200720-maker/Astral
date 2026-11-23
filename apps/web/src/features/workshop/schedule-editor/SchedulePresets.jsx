/*
 * Готовые виды табло — сеткой в панели «Шаблоны». Плитка — табло работы
 * (её строки, заголовок и шрифт) в цветах, прозрачности и свечении готового
 * вида — тем же листом, что уедет в игру. Отмечена плитка, с которой облик
 * работы совпадает; поправил цвет — это уже своё.
 */

import { memo, useEffect, useState } from "react";
import { SCHEDULE_PRESETS, applySchedulePreset, matchingSchedulePreset, normalizeScheduleProject } from "@modovik/climb-contract/recolor/schedule";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { scheduleTileImage } from "./schedule-sheet.js";
import { tr, useTr } from "../../../locales/ui.js";

function SchedulePresets({ project, onApply }) {
  useTr();
  const normal = normalizeScheduleProject(project);
  /* Плитки — по строкам и шрифту работы; облик у каждой свой. */
  const key = JSON.stringify([normal.title, normal.rows, normal.font, normal.fontAsset || "", normal.letters, normal.upper]);
  const [images, setImages] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    Promise.all(SCHEDULE_PRESETS.map(async (preset) => [preset.id, await scheduleTileImage(applySchedulePreset(normal, preset.id)).catch(() => "")]))
      .then((pairs) => !cancelled && setImages(new Map(pairs)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Плитки перерисовываются по строкам и шрифту работы (`key`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = matchingSchedulePreset(normal);
  return (
    <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды расписания")} className="recolor-presets" collapsible={false}>
      {SCHEDULE_PRESETS.map((preset) => {
        const href = images.get(preset.id);
        return (
          <ChoiceTile
            key={preset.id}
            className="recolor-preset"
            selected={preset.id === current}
            media={href ? <img src={href} alt="" /> : <i aria-hidden="true" />}
            title={preset.label}
            tooltip={preset.description}
            onClick={() => onApply(preset)}
          />
        );
      })}
    </PresetShelf>
  );
}

export default memo(SchedulePresets);
