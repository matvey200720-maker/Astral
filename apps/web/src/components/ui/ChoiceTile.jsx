import { createElement as h } from "react";
import { GlyphCheck } from "@astral/glyphs";

const tileClass = (selected, bare, extra) => ["ui-choice", selected && "is-selected", bare && "is-bare", extra].filter(Boolean).join(" ");

// Подпись плитки: название, пояснение и приписка; ноль в пояснении и приписке остаётся текстом «0».
const copyNode = (title, description, meta) =>
  h("span", { className: "ui-choice-copy" }, h("b", null, title), description && h("small", null, description), meta && h("em", null, meta));

const mediaNest = (media) => media && h("span", { className: "ui-choice-media", "aria-hidden": "true" }, media);

const checkMark = (selected, radio) => selected && radio && h("i", { className: "ui-choice-mark", "aria-hidden": "true" }, h(GlyphCheck));

export default function ChoiceTile(props) {
  const { media = null, title, description = null, meta = null, tooltip = null, selected = false, disabled = false, className = "", ariaLabel, onClick, radio = false, ...rest } = props;
  // Порядок ключей — порядок атрибутов; всё из rest ложится поверх и перекрывает своё, не меняя места.
  const own = {
    type: "button",
    className: tileClass(selected, !media, className),
    role: radio ? "radio" : undefined,
    "aria-pressed": radio ? undefined : selected,
    "aria-checked": radio ? selected : undefined,
    "aria-label": ariaLabel || undefined,
    title: tooltip || undefined,
    disabled,
    onClick,
  };
  return h("button", Object.assign(own, rest), mediaNest(media), checkMark(selected, radio), copyNode(title, description, meta));
}
