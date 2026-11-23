import { memo } from "react";
import ChoiceTile from "../../ui/ChoiceTile.jsx";
import PresetShelf, { PresetMarks } from "../../ui/PresetShelf.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { impactAccent } from "./impact-sim.js";
import { tracerHeadColour } from "./effects-preview.js";
import { projectHasPart } from "./effects-parts.js";
import {
  ENVIRONMENT_FAMILIES,
  IMPACT_ZONES,
  presetProject,
  tracerProfileActive,
} from "@modovik/ptfx-studio";

// Метка = подпись + цвет; подпись одновременно ключ списка (в одном наборе она не повторяется).
// Имена полей у PresetMarks в описании не названы: ключ отдаём как id и key, цвет — как colour и color.
const mark = (label, colour) => ({ id: label, key: label, label, colour, color: colour });

// Серый (#64748b) у «гасящих» пресетов, например «Чистый экран»: они не красят, а убирают.
// Метки несут содержание карточки: сколько меток, столько частей проекта пресет трогает (18.10.2026).
// Для остальных частей (other, muzzle, не задана) меток нет, гнездо картинки остаётся пустым.
const MARKS = {
  tracer: ({ tracer }) => {
    const lead = tracer.profiles.find(tracerProfileActive);
    return lead ? [mark(tr("След пули"), tracerHeadColour(lead))] : [];
  },
  impact: ({ impact }) =>
    impact.enabled
      ? IMPACT_ZONES.flatMap(({ id, label }) => {
          const zone = impact.zones?.[id];
          return zone?.enabled ? [mark(tr(label), impactAccent(zone))] : [];
        })
      : [],
  environment: ({ environment }) =>
    ENVIRONMENT_FAMILIES.flatMap(({ id, label }) => {
      const { enabled, tint, tintStrength } = environment[id] ?? {};
      return enabled ? [mark(tr(label), tintStrength > 0 ? tint : "#64748b")] : [];
    }),
};

export const partPresets = (presets, part) => presets.filter(({ project }) => projectHasPart(project, part));

// Полка без свёртки: она и есть всё содержимое панели «Шаблоны» (владелец, 03.10.2026).
// memo: тридцать плиток не пересобираются от каждого движения ползунка, свойства полки постоянны.
export default memo(function EffectsPresetRail({ part, presets, onApply, title = "Готовые пресеты" }) {
  useTr();
  const shown = partPresets(presets, part);
  return shown.length ? (
    <PresetShelf className="fx-presets" collapsible={false} count={shown.length} title={tr(title)}>
      {shown.map(({ id, label, description, project }) => (
        <ChoiceTile
          className="fx-preset"
          key={id}
          media={<PresetMarks marks={MARKS[part]?.(project) ?? []} />}
          onClick={() => onApply(presetProject(id))}
          title={tr(label)}
          tooltip={tr(description)}
        />
      ))}
    </PresetShelf>
  ) : null;
});
