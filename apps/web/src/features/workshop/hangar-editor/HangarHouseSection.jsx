/*
 * Вкладка «Дом» панели «Внутри» (мастерская ангара; слова владельца 23.11.2026: «у домика чтобы сам красился: стенки, окна; внутри не нужно… просто назови дом, у него цвет просто»).
 * Красится домик у торца зала, как его видно из ангара: «Стены» (блочная стенка) и «Окна» — строки цвета одним органом `ColourRow` (п. 16 `design-qa.md`): кружок, палитра на месте, «×» —
 * как в игре; как у «Ржавчины». «Стены» красят блоки, рамы и простенки (стены внутри домика получают тот же цвет: лист общий), «Окна» — стекло; дверь как в игре. Арифметика та же, что у стен ангара (`hangarHouseSheetLook`): светотень листа остаётся.
 *
 * Строка показывается, только если у поверхности есть лист в описи (`hangarHouseSurfaces`): нет листа — нет органа, заглушек цветом нет. Грузится по требованию (`HangarHouseHook.jsx`).
 */
import { HANGAR_HOUSE_COLOURS, hangarHouseSurfaces } from "@modovik/climb-contract/recolor/hangar-house";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import SectionHeading from "../section-help.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { HANGAR_HOUSE_WALLS_SWATCHES, HANGAR_HOUSE_WINDOWS_SWATCHES } from "./hangar-house-look.js";

/* Названия поверхностей и шаги истории — в месте отрисовки (до смены языка модульные строки ещё русские). */
const surfaceTitle = (surface) => ({ walls: tr("Стены"), windows: tr("Окна") })[surface];
const SWATCHES = Object.freeze({ walls: HANGAR_HOUSE_WALLS_SWATCHES, windows: HANGAR_HOUSE_WINDOWS_SWATCHES });
const STEP = Object.freeze({ walls: "Дом: стены", windows: "Дом: окна" });

export default function HangarHouseSection({ project, onStructure }) {
  useTr();
  const surfaces = hangarHouseSurfaces();
  if (!surfaces.length) return null;
  const house = project.house;
  const set = (surface, patch, text) =>
    onStructure({ house: { ...house, paint: { ...house.paint, [surface]: { mode: "standard", colour: HANGAR_HOUSE_COLOURS[surface], ...house.paint?.[surface], ...patch } } } }, text);
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={tr("Дом")} data-hangar-element="house">
      <SectionHeading
        title={tr("Дом")}
        help={[tr("Красится домик у торца зала, как его видно из ангара. Светотень листа остаётся, как у стен."), tr("«Стены» красят блоки, рамы и простенки; стены внутри домика получают тот же цвет — лист общий."), tr("«Окна» красят стекло, дверь остаётся как в игре.")]}
      />
      <ListGroup label={tr("Дом")}>
        {surfaces.map((surface) => {
          const paint = house.paint?.[surface];
          return (
            <ColourRow
              key={surface}
              title={surfaceTitle(surface)}
              label={`${surfaceTitle(surface)}: ${tr("цвет")}`}
              value={paint?.mode === "colour" ? paint.colour : null}
              colours={SWATCHES[surface]}
              onChange={(colour) => set(surface, { colour, mode: "colour" }, `${STEP[surface]}: цвет`)}
              onClear={() => set(surface, { mode: "standard" }, `${STEP[surface]}: как в игре`)}
            />
          );
        })}
      </ListGroup>
    </section>
  );
}
