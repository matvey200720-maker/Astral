/*
 * Раздел «Свет ламп» панели «Конструкции и свет» (мастерская ангара — цвета, часть А).
 *
 * Одна настройка на все лампы ангара — потолочные и на стенах: «Как в игре» или «Свой цвет» с цветом и силой света в процентах от штатной. Устроен по образцу «Света ламп» в «Магазинах»
 * (`shops-editor/ShopsInspector.jsx`) и только из существующих органов: `SegmentedControl`, `ColorField`, `Slider`, раздел `ui-panel fx-section`. Лампы выключены или убраны — прежнее гашение
 * сильнее цвета, поэтому цвет и силу не показываем: их нечем показать (`hangarStructure(project).lamps`).
 *
 * Правка идёт тем же шагом истории, что остальные переключатели ангара (`onStructure(значения, подпись)`); в игру едет только то, что входит в отпечаток «Применить» (`hangar-lights.js`).
 */

import {
  HANGAR_LIGHT_INTENSITY,
  HANGAR_LIGHT_LABELS,
  HANGAR_LIGHT_MODES,
  HANGAR_LIGHT_SWATCHES,
} from "@modovik/climb-contract/recolor/hangar-lights";
import { hangarStructure } from "@modovik/climb-contract/recolor/hangar";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SectionHeading from "../section-help.jsx";
import { percentText } from "./hangar-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const lightModes = () => HANGAR_LIGHT_MODES.map((value) => ({ value, label: tr(HANGAR_LIGHT_LABELS[value]) }));

export default function HangarLightSection({ project, onStructure }) {
  useTr();
  const lights = project.lights;
  const lit = hangarStructure(project).lamps;
  const set = (patch, label) => onStructure({ lights: { ...lights, ...patch } }, label);
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={tr("Свет ламп")} data-hangar-element="lights">
      <SectionHeading
        title={tr("Свет ламп")}
        help={[
          tr("Один цвет и одна сила на все лампы ангара: потолочные и на стенах. Сигнальные огоньки остаются своего цвета."),
          tr("Цвет света в кадре показан приближённо: точная яркость и свечение плафонов — в игре."),
          lit ? "" : tr("Лампы выключены или убраны: свет ламп ничего не покажет, пока они не включены."),
        ]}
      />
      <SegmentedControl label={tr("Свет ламп")} size="sm" value={lights.mode} options={lightModes()} onChange={(mode) => set({ mode }, tr("Свет ламп: режим"))} />
      {lights.mode === "colour" && lit && (
        <>
          <ColorField label={tr("Цвет света")} value={lights.colour} swatches={HANGAR_LIGHT_SWATCHES} editable onChange={(colour) => set({ colour }, tr("Свет ламп: цвет света"))} />
          <Slider
            label={tr("Сила света")}
            value={lights.intensity}
            min={HANGAR_LIGHT_INTENSITY[0]}
            max={HANGAR_LIGHT_INTENSITY[1]}
            step={5}
            format={percentText}
            onChange={(intensity) => set({ intensity }, tr("Свет ламп: сила света"))}
          />
        </>
      )}
    </section>
  );
}
