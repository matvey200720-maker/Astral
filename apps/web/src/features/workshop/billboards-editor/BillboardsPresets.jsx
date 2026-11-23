/*
 * Готовые наборы щитов — сеткой в панели «Шаблоны».
 *
 * Плитка — схема щита в облике набора (`BillboardArt`): это схема, а не
 * кадр из игры, рекламы Rockstar на ней нет. У наборов со своей картинкой
 * на плитке — ваша картинка, если она уже выбрана. Отмечена плитка, с
 * которой работа совпадает.
 */

import { memo } from "react";
import {
  BILLBOARDS_PRESETS,
  applyBillboardsPreset,
  matchingBillboardsPreset,
} from "@modovik/climb-contract/recolor/billboards";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import BillboardArt from "./BillboardArt.jsx";
import { tr, useTr } from "../../../locales/ui.js";

function BillboardsPresets({ project, onApply }) {
  useTr();
  const current = matchingBillboardsPreset(project);
  const imageUrl = useHangarEmblemUrl(project.all.image.asset);
  return (
    /* Без числа у заголовка и без плитки «Как в игре»: откат — строкой внизу «Шаблонов» (критик 30.10.2026). */
    <PresetShelf title={tr("Готовые наборы")} label={tr("Готовые наборы щитов")} className="recolor-presets" collapsible={false}>
      {BILLBOARDS_PRESETS.filter((preset) => preset.id !== "game").map((preset) => {
        const look = applyBillboardsPreset(project, preset.id).all;
        return (
          <ChoiceTile
            key={preset.id}
            className="recolor-preset"
            selected={preset.id === current}
            media={<BillboardArt look={look} imageUrl={imageUrl} label={`Схема: ${preset.label}`} />}
            title={preset.label}
            /* Описание — подсказкой: на плитке имя и превью, без обрезанного «…». */
            tooltip={tr(preset.description)}
            onClick={() => onApply(preset)}
          />
        );
      })}
    </PresetShelf>
  );
}

export default memo(BillboardsPresets);
