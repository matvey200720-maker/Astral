import { GlyphCheck } from "@astral/glyphs";
import { createElement } from "react";

// Знак выбора: сам не нажимается и ничего не хранит, включённость — класс is-on.
function SelectionMark({ on = false, className = "" }) {
  const parts = ["ui-check"];
  if (on) parts.push("is-on");
  if (className) parts.push(className);

  const glyph = createElement(GlyphCheck);
  return createElement("em", { className: parts.join(" "), "aria-hidden": "true" }, glyph);
}

export default SelectionMark;
