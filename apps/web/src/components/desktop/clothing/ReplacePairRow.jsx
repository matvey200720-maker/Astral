import { ArrowRight } from "../../ui/icons.jsx";
import Checkbox from "../../ui/Checkbox.jsx";
import "./replace-pair.css";

/*
 * Строка окна установки (`WearOutfitDialog`, владелец 29.10.2026; тату — `TattooPartRow`, владелец 01.11.2026: «то же самое должно быть, как у обуви, вот этого низа»):
 * отметка «ставить», название, «?» или то, что заменяем → наша заменёнка, и подпись справа. Нажатие на «?» открывает окно выбора; снятая отметка — строка в установку не идёт.
 */
export default function ReplacePairRow({ slot, on = true, installable = true, checkLabel = "", title, note = null, chosen = false, from = null, fromLabel = "", fromTitle = "", onPick, to = null, meta = null, onToggle }) {
  return (
    <li className={`wear-outfit-row${on ? "" : " is-skipped"}${installable ? "" : " is-separate"}`} data-slot={slot}>
      {installable ? (
        <Checkbox className="wear-outfit-check" checked={on} ariaLabel={checkLabel} onChange={onToggle} />
      ) : (
        <span className="wear-outfit-check" aria-hidden="true" />
      )}
      <span className="wear-outfit-name">
        <b>{title}</b>
        {note ? <small>{note}</small> : null}
      </span>
      <span className="wear-outfit-pair">
        <button type="button" className={`wear-outfit-from${chosen ? " is-chosen" : ""}`} disabled={!installable || !on} aria-label={fromLabel} title={fromTitle} onClick={onPick}>
          {chosen ? (
            from
          ) : (
            <span className="wear-outfit-question" aria-hidden="true">
              ?
            </span>
          )}
        </button>
        <span className="wear-outfit-arrow" aria-hidden="true">
          <ArrowRight weight="bold" />
        </span>
        <span className="wear-outfit-to">{to}</span>
      </span>
      <span className="wear-outfit-meta">{meta}</span>
    </li>
  );
}
