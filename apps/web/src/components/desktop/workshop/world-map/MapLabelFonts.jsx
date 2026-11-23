import { createElement as h } from "react";
import { Check } from "../../../ui/icons.jsx";
import { FONT_FAMILIES, MAP_FONTS, customFontFamily, isCustomLabelFont } from "@modovik/vector-map";
import MapFontSources from "./MapFontSources.jsx";
import { useMapFonts } from "./MapFontsContext.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

// Прежние шрифты: показываются, только пока выбраны. Обычный объект (как раньше).
const FORMER_FONT_NAMES = {
  condensed: "Узкий",
  heavy: "Плотный",
  display: "Плакатный",
  stock: "Как в игре",
  wide: "Широкий",
};

const AUDIT_OFF = "type-scale caps";

// Строка списка: { slot, value, title, family?, inherit? }
function collectRows(value, emptyLabel, fonts) {
  const head = [
    { slot: "inherit", value: "", title: emptyLabel ? tr(emptyLabel) : emptyLabel, inherit: true },
    { slot: "astral", value: "astral", title: "Astral", family: FONT_FAMILIES.astral },
  ];
  const mapFonts = MAP_FONTS.map(({ id, title, family }) => ({ slot: id, value: id, title: tr(title), family }));
  const former = FORMER_FONT_NAMES[value]
    ? [{ slot: value, value, title: tr(FORMER_FONT_NAMES[value]), family: FONT_FAMILIES[value] }]
    : [];
  const own = fonts.map(({ id, name }) => ({
    slot: "custom:" + id,
    value: "custom:" + id,
    title: name,
    family: customFontFamily(id),
  }));
  const lost =
    isCustomLabelFont(value) && !own.some((row) => row.value === value)
      ? [{ slot: value, value, title: tr("Свой шрифт") }]
      : [];
  return [...head, ...mapFonts, ...former, ...own, ...lost];
}

export default function LabelFontList({ value = "", emptyLabel, onChange, label }) {
  useTr();
  const { fonts } = useMapFonts();
  const rows = collectRows(value, emptyLabel, fonts);

  const rowButton = (row) => {
    const selected = row.value === value;
    const caption = h("b", {
      "data-audit-ignore": AUDIT_OFF,
      style: row.family ? { fontFamily: row.family } : undefined,
    }, row.title);
    const classes = ["wmc-font-row", selected && "is-active", row.inherit && "is-inherit"];
    return h(
      "button",
      {
        key: row.slot,
        type: "button",
        role: "radio",
        "aria-checked": selected,
        className: classes.filter(Boolean).join(" "),
        onClick: () => onChange(row.value),
      },
      caption,
      selected ? h(Check, { weight: "bold", "aria-hidden": "true" }) : null,
    );
  };

  return h(
    "div",
    {
      className: "wmc-font-list wmc-label-fonts",
      role: "radiogroup",
      "aria-label": label === undefined ? tr("Шрифт") : label,
    },
    rows.map(rowButton),
    h(MapFontSources, { onPick: onChange }),
  );
}
