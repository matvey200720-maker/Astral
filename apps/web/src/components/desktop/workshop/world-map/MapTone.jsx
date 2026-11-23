import { createElement as h, Fragment } from "react";
import ColorPicker from "../../../ui/ColorPicker.jsx";
import Select from "../../../ui/Select.jsx";
import Slider from "../../../ui/Slider.jsx";
import { blendOptions } from "../WorldMapStylePanels.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

export const SCHEMATIC_COLORS = Object.freeze([
  { key: "land", label: "Суша" },
  { key: "terrain", label: "Рельеф" },
  { key: "sand", label: "Песок" },
  { key: "roads", label: "Дороги" },
  { key: "highways", label: "Магистрали" },
  { key: "buildings", label: "Застройка" },
  { key: "runway", label: "Полосы аэродромов" },
  { key: "outline", label: "Обводка берега" },
]);

// Ползунки: [поле base, подпись, мин, макс, шаг, единица, подпись правки]
const BRIGHTNESS = ["brightness", "Яркость", 40, 180, 1, "%", "Изменена яркость"];
const CONTRAST = ["contrast", "Контраст", 40, 200, 1, "%", "Изменён контраст"];
const SATURATION = ["saturation", "Насыщенность", 0, 200, 1, "%", "Изменена насыщенность"];
const TINT_STRENGTH = ["tintOpacity", "Сила цвета", 0, 100, 1, "%", "Сила основного цвета"];
const ROAD_WIDTH = ["roadWidth", "Ширина дорог", 20, 320, 1, "%", "Изменена ширина дорог"];
const OUTLINE_WIDTH = ["outlineWidth", "Толщина обводки", 0, 12, 0.1, "", "Изменена обводка"];
const EDGE_GLOW = ["edgeGlow", "Ореол берега", 0, 100, 1, "%", "Изменён ореол берега"];

function slider(base, onPatch, [field, label, min, max, step, unit, caption]) {
  return h(Slider, {
    key: field,
    label: tr(label),
    value: base[field],
    min,
    max,
    step,
    unit,
    onChange: (value) => onPatch({ [field]: value }, tr(caption), "base." + field),
  });
}

// Строка «образец цвета + подпись» в своей обёртке.
function colorBlock(key, label, value, apply) {
  const name = tr(label);
  return h(
    "div",
    { key, className: "wmc-color-lines" },
    h(
      "div",
      { className: "wmc-color-line" },
      h(ColorPicker, { label: name, value, onChange: apply }),
      h("span", null, name),
    ),
  );
}

const showsBackdrop = (source) => ["game", "template"].includes(source);

export function MapTone({ base, source = "", onPatch }) {
  useTr();
  const sliders = [BRIGHTNESS, CONTRAST, SATURATION].map((spec) => slider(base, onPatch, spec));
  const tint = colorBlock("tint", "Общий цвет карты", base.tintColor, (tintColor) =>
    onPatch({ tintColor }, tr("Основной цвет карты"), "base.tintColor"),
  );
  const blend = h(Select, {
    key: "blend",
    className: "wmc-select",
    label: tr("Наложение цвета"),
    value: base.tintBlend,
    options: blendOptions(),
    onChange: (tintBlend) => onPatch({ tintBlend }, tr("Наложение цвета"), "base.tintBlend"),
  });
  const strength = slider(base, onPatch, TINT_STRENGTH);
  const backdrop = showsBackdrop(source)
    ? [
        colorBlock("backdrop", "Фон за картой в редакторе", base.backdropColor, (backdropColor) =>
          onPatch({ backdropColor }, tr("Изменён фон редактора"), "base.backdropColor"),
        ),
        h("small", { key: "note", className: "wmc-hint" }, tr("Фон — только для редактора, в игру он не уезжает: море рисует сама игра.")),
      ]
    : [];
  return h(Fragment, null, ...sliders, tint, blend, strength, ...backdrop);
}

export function SchematicLines({ base, onPatch }) {
  useTr();
  return h(
    Fragment,
    null,
    slider(base, onPatch, ROAD_WIDTH),
    slider(base, onPatch, OUTLINE_WIDTH),
    slider(base, onPatch, EDGE_GLOW),
    colorBlock("glow", "Цвет ореола", base.edgeGlowColor, (edgeGlowColor) =>
      onPatch({ edgeGlowColor }, tr("Изменён цвет ореола"), "base.edgeGlowColor"),
    ),
  );
}
