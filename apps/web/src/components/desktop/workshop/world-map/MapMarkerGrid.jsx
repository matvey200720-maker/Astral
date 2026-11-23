import { createElement } from "react";
import { glyphPath, GLYPH_BOX, MARKER_CATEGORIES, MARKER_CATEGORY_MAP } from "@modovik/vector-map";
import { Plus, Minus } from "../../../ui/icons.jsx";
import { useTr, tr } from "../../../../locales/ui.js";

const h = createElement;

export const POPULAR_MARKERS = Object.freeze("fuel medic police shop bank car weapon garage".split(" "));

const hasGlyph = (entry) => entry.glyph !== "none";
export const ICON_MARKERS = Object.freeze(MARKER_CATEGORIES.filter(hasGlyph));

export function MarkerGlyph(props) {
  const outline = glyphPath(props.name);
  if (outline) {
    const side = GLYPH_BOX;
    const svgProps = { className: "wmc-glyph", viewBox: `0 0 ${side} ${side}`, "aria-hidden": "true" };
    return h("svg", svgProps, h("path", { d: outline, fill: "currentColor" }));
  }
  return h("i", { className: "wmc-glyph-dot", "aria-hidden": "true" });
}

// Редкий значок с пиктограммой, которого нет среди ходовых.
function rareChoice(value) {
  if (!Object.hasOwn(MARKER_CATEGORY_MAP, value)) return null;
  const entry = MARKER_CATEGORY_MAP[value];
  return hasGlyph(entry) && !POPULAR_MARKERS.includes(entry.id) ? entry : null;
}

// Свёрнуто: восемь ходовых, выбранный редкий занимает последнее место.
export function visibleMarkers(value, open) {
  if (open) return ICON_MARKERS;
  const shown = POPULAR_MARKERS.map((id) => MARKER_CATEGORY_MAP[id]);
  const extra = rareChoice(value);
  if (extra) shown[shown.length - 1] = extra;
  return shown;
}

function tileProps(entry, value, onChange) {
  const active = entry.id === value;
  const name = tr(entry.title);
  return {
    key: entry.id,
    type: "button",
    role: "option",
    "aria-selected": active,
    "aria-label": name,
    title: name,
    className: active ? "is-active" : "",
    style: { "--wmc-category": entry.color },
    onClick: () => onChange(entry.id),
  };
}

const TOGGLE_WORDS = {
  open: { label: "Свернуть значки", title: "Свернуть", Icon: Minus },
  closed: { label: "Все значки", title: "Все значки", Icon: Plus },
};

function toggleButton(open, onToggle) {
  const { label, title, Icon } = TOGGLE_WORDS[open ? "open" : "closed"];
  const props = {
    type: "button",
    className: "wmc-marker-more",
    "aria-expanded": open,
    "aria-label": tr(label),
    title: tr(title),
    onClick: onToggle,
  };
  return h("button", props, h(Icon, { weight: "bold", "aria-hidden": "true" }));
}

export default function MapMarkerGrid(props) {
  const { value, onChange, label, onToggle } = props;
  const open = props.open === undefined ? false : props.open;
  useTr();
  const tiles = [];
  for (const entry of visibleMarkers(value, open)) {
    tiles.push(h("button", tileProps(entry, value, onChange), h(MarkerGlyph, { name: entry.glyph })));
  }
  const options = h("div", { className: "wmc-marker-options", role: "listbox", "aria-label": label }, tiles);
  return h("div", { className: "wmc-marker-grid" + (open ? " is-open" : "") }, options, toggleButton(open, onToggle));
}
