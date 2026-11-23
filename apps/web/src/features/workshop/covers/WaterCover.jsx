import { useMemo } from "react";
import { createWaterProject, matchingWaterPreset, normalizeWaterProject } from "@modovik/climb-contract/recolor/water";
import { waterPresetPicture } from "../water-editor/water-preset-pictures.js";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка воды — настоящее море у Венис-Бич из игры в облике готового вида (ТЗ 27.10.2026), а не блок воды на сетке.
 *
 * Плитка полки и обложка работы — готовые картинки (`covers/stock-covers.js`, снимок кадра редактора при «Сохранить»); этот рисователь —
 * запасной вид: работа совпала с готовым видом — его картинка из поставки (`water-preset-pictures.js`), своя вода — ничего: честного
 * кадра её воды без редактора нет, а рисовать плиту вместо него не надо.
 */
export default function WaterCover({ state = null }) {
  const src = useMemo(() => {
    const stored = parseCoverState(state);
    return waterPresetPicture(matchingWaterPreset(stored ? normalizeWaterProject(stored) : createWaterProject()));
  }, [state]);
  if (!src) return null;
  return (
    <span className="workshop-cover-canvas">
      <img className="workshop-cover-image" src={src} alt="" draggable="false" decoding="async" />
    </span>
  );
}
