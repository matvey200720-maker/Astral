/*
 * Готовые зоны каптов — сеткой в панели «Шаблоны». Плитка — шайба зоны (в
 * кадре или «Церкви», если правятся все) в облике готового вида — тем же
 * рисователем, что обложка. Отмечена плитка, с которой работа совпадает;
 * поправил цвет — это уже своё.
 */

import { memo } from "react";
import { CAPT_ZONES_PRESETS, applyCaptZonesPreset, matchingCaptZonesPreset } from "@modovik/climb-contract/recolor/capt-zones";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { captZoneCanvas } from "./capt-zones-art.js";
import { usePresetTiles } from "../preset-tiles.js";
import { ALL_ZONES } from "./capt-zones-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const TILE_ZONE = "cercov";
const PRESET_IDS = CAPT_ZONES_PRESETS.map((preset) => preset.id);
/* Готовые плитки по зоне: выбор зоны рисует их по одной (`preset-tiles.js`), повторный — из кэша. */
const tileCache = new Map();

function CaptZonesPresets({ project, target = ALL_ZONES, onApply }) {
  useTr();
  const zoneId = target === ALL_ZONES ? TILE_ZONE : target;
  /* Плитки не зависят от работы: вид готового набора — всегда его собственный. */
  const images = usePresetTiles(PRESET_IDS, zoneId, (id) => captZoneCanvas(zoneId, applyCaptZonesPreset({}, id)), tileCache);
  const current = matchingCaptZonesPreset(project);
  return (
    <PresetShelf title={tr("Готовые зоны")} label={tr("Готовые виды зон каптов")} className="recolor-presets" collapsible={false}>
      {CAPT_ZONES_PRESETS.map((preset) => {
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

export default memo(CaptZonesPresets);
