/*
 * Готовые облики помещения в панели «Шаблоны»: цвет и блеск стен, пола,
 * потолка, полок и прилавка (ТЗ 12.10.2026, задача 2: только цвет и
 * «плитка — яркая, как будто бы зеркалила, идеально чистая»). Готовые
 * интерьеры с заменой вещей убраны вместе с заменами.
 *
 * Плитка — схема угла комнаты цветами шаблона (`ShopRoomArt`): это схема, а
 * не кадр из игры. Шаблон ложится на помещение, выбранное над кадром;
 * отмечена плитка, с которой оно совпадает.
 */

import { memo } from "react";
import { SHOPS_PRESETS, applyShopsPreset, createShopsProject, matchingShopsPreset, shopInterior } from "@modovik/climb-contract/recolor/shops";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import ShopRoomArt from "./ShopRoomArt.jsx";
import { fill } from "./shops-text.js";
import { tr, useTr } from "../../../locales/ui.js";

function ShopsPresets({ project, interiorId, onApply }) {
  useTr();
  const current = matchingShopsPreset(project, interiorId);
  const interior = shopInterior(interiorId);
  return (
    <PresetShelf title={tr("Готовые облики")} label={tr("Готовые облики помещения")} className="recolor-presets" collapsible={false}>
      {SHOPS_PRESETS.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset shops-preset"
          selected={preset.id === current}
          media={<ShopRoomArt look={applyShopsPreset(createShopsProject(), interiorId, preset.id).interiors[interiorId]} interior={interior} label={fill(tr("Схема шаблона «{0}»"), tr(preset.label))} />}
          title={tr(preset.label)}
          description={tr(preset.description)}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(ShopsPresets);
