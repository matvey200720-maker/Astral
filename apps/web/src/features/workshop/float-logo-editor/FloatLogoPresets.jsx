/*
 * Готовые виды «Летающего лого» — размер, высота, движение, цвет и
 * свечение разом; картинка или надпись остаются своими. Плитка — словами:
 * превью у видов одинаковое, что в виде — подсказкой.
 */

import { memo } from "react";
import { FLOAT_LOGO_PRESETS, matchingFloatLogoPreset } from "@modovik/climb-contract/recolor/float-logo";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { tr, useTr } from "../../../locales/ui.js";

function FloatLogoPresets({ project, onApply }) {
  useTr();
  const current = matchingFloatLogoPreset(project);
  return (
    /* Без числа у заголовка; «Как в игре» (вид мода) — не плиткой, а строкой внизу «Шаблонов» (критик 30.10.2026). */
    <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды лого")} className="recolor-presets" collapsible={false}>
      {FLOAT_LOGO_PRESETS.filter((preset) => preset.id !== "mod").map((preset) => {
        return (
          <ChoiceTile
            key={preset.id}
            className="recolor-preset float-logo-preset"
            selected={preset.id === current}
            /* Превью у всех одно (белая плашка, разница — в свечении): показывать нечего — плитка словами, что в виде — подсказкой. */
            title={preset.label}
            tooltip={tr(preset.description)}
            onClick={() => onApply(preset)}
          />
        );
      })}
    </PresetShelf>
  );
}

export default memo(FloatLogoPresets);
