import { Fragment } from "react";
import { CaretDown } from "../../ui/icons.jsx";

// Какое слово из copy нужно свёрнутой полке и какое раскрытой (по истинности expanded).
const FIELDS = {
  summary: { collapsed: "featuredWeapons", expanded: "allWeapons" },
  action: { collapsed: "expandWeapons", expanded: "collapseWeapons" },
};

const wordOf = (copy, slot, expanded) => copy[FIELDS[slot][expanded ? "expanded" : "collapsed"]];

// Подпись текущего содержимого полки.
const headline = (text) => (
  <div className="weapon-catalog-disclosure-summary">
    <span>{text}</span>
  </div>
);

// Значок справа от текста кнопки.
const ICON_SLOT = (
  <span className="weapon-catalog-disclosure-icon">
    <CaretDown aria-hidden="true" />
  </span>
);

// Текст кнопки и значок справа от него.
const buttonFace = (action) => {
  const label = (
    <span className="weapon-catalog-disclosure-copy">
      <b>{action}</b>
    </span>
  );
  return (
    <Fragment>
      {label}
      {ICON_SLOT}
    </Fragment>
  );
};

// Кнопка: подпись действия и связь с полкой; expanded идёт в aria-expanded как есть.
function toggleButton(expanded, action, onToggle) {
  const tone = expanded ? "is-expanded" : "";
  const naming = { "aria-label": action, title: action };
  return (
    <button onClick={onToggle} type="button" className={tone} aria-expanded={expanded} {...naming} aria-controls="weapon-catalog-grid">
      {buttonFace(action)}
    </button>
  );
}

export default function WeaponShelfDisclosure({ expanded, copy, onToggle }) {
  const marks = { "data-expanded": expanded || undefined };
  const lead = headline(wordOf(copy, "summary", expanded));
  return (
    <header className="weapon-catalog-controls" {...marks}>
      {lead}
      {toggleButton(expanded, wordOf(copy, "action", expanded), onToggle)}
    </header>
  );
}
