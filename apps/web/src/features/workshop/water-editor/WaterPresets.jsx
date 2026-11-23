/*
 * Готовые виды воды — сеткой под кадром, как готовые зоны.
 *
 * Плитка — настоящее море у Венис-Бич из игры в облике готового вида (ТЗ 27.10.2026): цвет
 * глади от берега к глубине и то, насколько сквозь неё видно дно, — та же арифметика, что
 * у установщика. Картинка готовая, из поставки (`water-preset-pictures.js`): игра ей не нужна.
 * Отмечена плитка, с которой работа совпадает; поправил цвет — это уже своё.
 */

import { memo } from "react";
import { WATER_PRESETS, matchingWaterPreset } from "@modovik/climb-contract/recolor/water";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { waterPresetPicture } from "./water-preset-pictures.js";
import { tr, useTr } from "../../../locales/ui.js";

/* На плитке — вода крупно (`.water-preset-art`): целиком кадр — небо, пляж и вода полоской, и виды различались только оттенком
   узкой полосы (п. 20, четвёртый круг критика 31.10.2026). */
function PresetArt({ presetId }) {
  return <img className="water-preset-art" src={waterPresetPicture(presetId)} alt="" width={650} height={312} loading="lazy" decoding="async" draggable={false} />;
}

function WaterPresets({ project, onApply }) {
  useTr();
  const current = matchingWaterPreset(project);
  return (
    <PresetShelf
      title={tr("Готовая вода")}
      label={tr("Готовые виды воды")}
     
      className="recolor-presets"
      collapsible={false}
    >
      {WATER_PRESETS.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={<PresetArt presetId={preset.id} />}
          title={preset.label}
          tooltip={preset.description}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(WaterPresets);
