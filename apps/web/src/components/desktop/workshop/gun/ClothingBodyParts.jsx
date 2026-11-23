import Button from "../../../ui/Button.jsx";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { trKey } from "./gun-copy.js";

/*
 * «Части тела» мастерской одежды (ТЗ 06.10.2026, вечер, задача 3): камера
 * подлетает к части, и кисть, заливка, картинка и текст ложатся на неё —
 * у каждой части свой лист рисунка (зона тату игры). Деталь в «Слоях»
 * встаёт на ту же часть: заливка и маски идут по ней.
 */

export const BODY_PARTS = Object.freeze([
  { id: "head", title: trKey("Голова и шея"), material: "tattoo_head", side: "front" },
  { id: "chest", title: trKey("Грудь и живот"), material: "tattoo_torso", side: "front" },
  { id: "back", title: trKey("Спина"), material: "tattoo_torso", side: "back" },
  { id: "arm-left", title: trKey("Левая рука"), material: "tattoo_arm_left", side: "outside" },
  { id: "arm-right", title: trKey("Правая рука"), material: "tattoo_arm_right", side: "outside" },
  { id: "leg-left", title: trKey("Левая нога"), material: "tattoo_leg_left", side: "front" },
  { id: "leg-right", title: trKey("Правая нога"), material: "tattoo_leg_right", side: "front" },
]);

export default function ClothingBodyParts({ active = "", available = null, onFocus, onWhole }) {
  useTr();
  return (
    <section className="ui-panel gun-panel clothing-body-parts" aria-label={tr("Части тела")}>
      <p className="gun-hint">
        {tr("Выбери часть — камера подлетит к ней. Кисть, заливка, картинка и текст ложатся на эту часть; в игре рисунок встанет туда же.")}
      </p>
      <div className="clothing-body-grid">
        {BODY_PARTS.map((part) => (
          <ChoiceTile
            key={part.id}
            title={tr(part.title)}
            selected={active === part.id}
            disabled={Boolean(available) && !available.has(part.material)}
            onClick={() => onFocus(part)}
          />
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={onWhole}>
        {tr("Показать персонажа целиком")}
      </Button>
    </section>
  );
}
