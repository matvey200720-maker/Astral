/*
 * Готовые виды «Дирижаблей» — состав неба (сколько чего летает), место и
 * высота разом; надпись, лого и цвета остаются своими. Плитка — 3D-снимок
 * неба этого вида в облике работы (ТЗ 11.10.2026, вечер: модели рисуются
 * сразу): те же модели, что в кадре и в игре, моделей Rockstar в поставке
 * нет — дирижабль из игры игрока.
 */

import { memo } from "react";
import { AIRSHIP_PRESETS, matchingAirshipsPreset } from "@modovik/climb-contract/recolor/airships";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";

/*
 * Плитка — имя, описание в подсказке; снимка неба на плитке нет (п. 20 `design-qa.md`, третий круг критика 30.10.2026): без
 * моделей игры часть снимков выходила чёрной, а разница между видами неба видна в кадре сразу после щелчка.
 */
function PresetTile({ preset, selected, onApply }) {
  return (
    <ChoiceTile
      className="recolor-preset airships-preset"
      selected={selected}
      title={preset.label}
      tooltip={preset.description}
      onClick={() => onApply(preset)}
    />
  );
}

function AirshipsPresets({ project, onApply }) {
  const current = matchingAirshipsPreset(project);
  return (
    <PresetShelf title="Готовые виды" label="Готовые виды неба" className="recolor-presets" collapsible={false}>
      {AIRSHIP_PRESETS.map((preset) => (
        <PresetTile key={preset.id} preset={preset} selected={preset.id === current} onApply={onApply} />
      ))}
    </PresetShelf>
  );
}

export default memo(AirshipsPresets);
