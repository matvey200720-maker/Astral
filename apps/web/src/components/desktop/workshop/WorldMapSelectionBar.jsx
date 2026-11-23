import { createElement as el } from "react";
import { tr, useTr } from "../../../locales/ui.js";
import { mapText } from "./world-map/map-copy.js";
import { counted } from "../../../plural.js";
import { MOD } from "./world-map-shortcuts.js";
import { BoundingBox, SelectionSlash, Trash, X } from "../../ui/icons.jsx";
import ColorPicker from "../../ui/ColorPicker.jsx";
import Button from "../../ui/Button.jsx";

const WHITE = "#ffffff";

// Кнопки полоски: [вариант, значок, текст или подпись для кнопки без текста].
const BUTTONS = {
  group: ["secondary", BoundingBox, "Сгруппировать"],
  ungroup: ["ghost", SelectionSlash, "Разгруппировать"],
  remove: ["ghost", Trash, "Удалить"],
  clear: ["ghost", X, null],
};

function barButton(slot, onClick, title) {
  const [variant, Glyph, text] = BUTTONS[slot];
  const props = { key: slot, variant, size: "sm", icon: el(Glyph), onClick, title };
  if (text !== null) return el(Button, props, tr(text));
  return el(Button, { ...props, ariaLabel: tr("Снять выделение") });
}

// «Выбрано N объектов»: всё нечисловое читается как 0.
function selectedLabel(raw) {
  const n = Number(raw);
  const forms = ["объект", "объекта", "объектов"].map((word) => tr(word));
  return mapText("Выбрано {count}", { count: counted(Number.isNaN(n) ? 0 : n, forms) });
}

export default function WorldMapSelectionBar(props) {
  useTr();
  const { count, grouped = false, colour = "", onColour = null } = props;
  const { onGroup, onUngroup, onRemove, onClear } = props;

  const swatch =
    onColour &&
    el(ColorPicker, {
      key: "colour",
      className: "wmc-selection-colour",
      size: "sm",
      label: tr("Цвет всех выбранных"),
      value: colour || WHITE,
      onChange: onColour,
    });

  return el(
    "div",
    {
      className: "wmc-selection-bar",
      role: "toolbar",
      "aria-label": tr("Выделено несколько объектов"),
    },
    el("span", { className: "wmc-selection-count" }, selectedLabel(count)),
    barButton("group", onGroup, `${MOD}+G`),
    grouped && barButton("ungroup", onUngroup, `${MOD}+Shift+G`),
    swatch,
    barButton("remove", onRemove, "Delete"),
    barButton("clear", onClear),
  );
}
