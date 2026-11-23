/*
 * Готовые МСЛ-зоны — сеткой в панели «Шаблоны». Плитка — линии района
 * «Центр» сверху в облике готового вида (`paintMslZones`, из той же сцены
 * описи, что кадр). Отмечена плитка, с которой работа совпадает.
 */

import { memo, useMemo } from "react";
import { MSL_ZONES_PRESETS, applyMslZonesPreset, matchingMslZonesPreset } from "@modovik/climb-contract/recolor/msl-zones";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { mslZonesImage, useMslScene } from "./msl-zones-art.js";
import { tr, useTr } from "../../../locales/ui.js";

function MslZonesPresets({ project, onApply }) {
  useTr();
  const asset = useMslScene();
  const images = useMemo(
    () => new Map(MSL_ZONES_PRESETS.map((preset) => [preset.id, asset ? mslZonesImage(asset, "city", applyMslZonesPreset({}, preset.id)) : ""])),
    [asset],
  );
  const current = matchingMslZonesPreset(project);
  return (
    <PresetShelf title={tr("Готовые виды")} label={tr("Готовые виды МСЛ-зон")} className="recolor-presets" collapsible={false}>
      {MSL_ZONES_PRESETS.map((preset) => {
        const href = images.get(preset.id);
        return (
          <ChoiceTile
            key={preset.id}
            className="recolor-preset"
            selected={preset.id === current}
            media={href ? <img src={href} alt="" /> : <i aria-hidden="true" />}
            title={tr(preset.label)}
            tooltip={tr(preset.description)}
            onClick={() => onApply(preset)}
          />
        );
      })}
    </PresetShelf>
  );
}

export default memo(MslZonesPresets);
