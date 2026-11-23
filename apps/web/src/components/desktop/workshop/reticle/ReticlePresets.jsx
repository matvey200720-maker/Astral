import { memo } from "react";
import {
  ORDINARY_PRESETS,
  SNIPER_PRESETS,
  reticlePresetConfig,
} from "@modovik/reticle-contract";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import PresetShelf from "../../../ui/PresetShelf.jsx";
import { ReticleThumb } from "./ReticleArt.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Готовые прицелы — сеткой в панели инструмента «Шаблоны» (мастерская «как
 * в Photoshop», 03.10.2026), как готовые виды у завода и зон. Полка там —
 * всё содержимое панели, поэтому без переключателя: видна сразу. Плитка
 * рисует свой прицел теми же фигурами, что уйдут в игру.
 *
 * Выбранной плитки нет: пресет — отправная точка, а не состояние. Поправил
 * толщину — это уже свой прицел, и подсвеченная плитка врала бы.
 */

/* Подложка плитки: у снайперки — весь экран с линзой, серый, как вид в
   оптике; обычный прицел — на тёмном, как в кадре. */
const PLATES = Object.freeze({ ordinary: "#0f1012", sniper: "#6f747c" });

function ReticlePresets({ kind, onApply }) {
  useTr();
  const presets = kind === "sniper" ? SNIPER_PRESETS : ORDINARY_PRESETS;
  return (
    <PresetShelf
      title={kind === "sniper" ? tr("Готовая оптика") : tr("Готовые прицелы")}
      count={presets.length}
      className="reticle-presets"
      collapsible={false}
    >
      {presets.map((item) => (
        <ChoiceTile
          key={item.id}
          className="reticle-preset"
          media={
            <ReticleThumb
              kind={kind}
              config={reticlePresetConfig(kind, item)}
              aspect={16 / 9}
              zoom={0.8}
              screen={kind === "sniper"}
              plate={PLATES[kind]}
              className="reticle-preset-art"
            />
          }
          title={tr(item.label)}
          /* Плитка — кадр и имя, описание всплывает (18.10.2026, владелец:
             панели «перегружены»). */
          tooltip={tr(item.description)}
          onClick={() => onApply(item)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(ReticlePresets);
