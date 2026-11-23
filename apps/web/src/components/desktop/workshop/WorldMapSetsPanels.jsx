import { Fragment, createElement as el } from "react";
import { mapText } from "./world-map/map-copy.js";
import { tr, useTr } from "../../../locales/ui.js";
import MapFontSources from "./world-map/MapFontSources.jsx";
import { useMapFonts } from "./world-map/MapFontsContext.jsx";
import {
  customFontOptions,
  labelFontOptions,
  labelWeightOptions,
} from "./world-map/label-options.js";
import { mapGroupStyle, setMapGroupStyle } from "@modovik/vector-map";
import ToggleGrid from "../../ui/ToggleGrid.jsx";
import Slider from "../../ui/Slider.jsx";
import Select from "../../ui/Select.jsx";
import ColorPicker from "../../ui/ColorPicker.jsx";
import Button from "../../ui/Button.jsx";
import { TextAa } from "../../ui/icons.jsx";

// Ползунки по порядку: [поле, подпись, подпись для чтения с экрана, от, до, единица, шаг истории].
const SLIDERS = [
  ["scale", "Размер", "Размер подписей", 50, 250, "%", "Размер подписей набора"],
  ["spacing", "Разрядка", undefined, -10, 60, "%", "Разрядка подписей набора"],
  ["outline", "Обводка", undefined, 0, 100, undefined, "Обводка подписей набора"],
];

// Образцы цвета: [поле, подпись, цвет-заглушка, нужна ли обводка, шаг истории].
const SWATCHES = [
  ["color", "Цвет подписей набора", "#ffffff", false, "Цвет подписей набора"],
  ["outlineColor", "Цвет обводки подписей набора", "#04060a", true, "Цвет обводки подписей набора"],
];

// Что «Как у всех» возвращает к умолчаниям.
const DEFAULTS = [
  ["font", ""],
  ["weight", ""],
  ["scale", 100],
  ["spacing", 0],
  ["color", ""],
  ["outline", null],
  ["outlineColor", ""],
  ["caps", false],
];

// Свои настройки есть, если выполнено хотя бы одно из условий.
const OWN_RULES = [
  (v) => v.font,
  (v) => v.weight,
  (v) => v.scale !== 100,
  (v) => v.spacing !== 0,
  (v) => v.color,
  (v) => v.outline !== null,
  (v) => v.outlineColor,
  (v) => v.caps,
];

function capsVariant() {
  const hint = tr("Все буквы подписи — заглавные");
  return {
    value: "caps",
    label: el(Fragment, null, el(TextAa, { "aria-hidden": "true" }), " ", tr("Прописные")),
    ariaLabel: tr("Прописные"),
    tooltip: hint,
  };
}

export function GroupLabelStyle({ config, section, group, onConfig }) {
  useTr();
  const { fonts } = useMapFonts();

  const part = config[section];
  const look = mapGroupStyle(part, group.id);
  const outline = look.outline ?? part.labelOutline ?? 0;
  const current = { scale: look.scale, spacing: look.spacing, outline };

  // правка вида набора: один вызов onConfig с проектом, подписью шага и свойством
  const editor = (step, prop) => (patch) =>
    onConfig(setMapGroupStyle(config, section, group.id, patch), tr(step), prop);
  const editFont = editor("Шрифт подписей набора");
  const propOf = (field) => `group.${field}.${group.id}`;

  const fontSelect = el(Select, {
    label: tr("Шрифт"),
    className: "wmc-select",
    ariaLabel: tr("Шрифт подписей"),
    value: look.font,
    options: labelFontOptions("Как у всех", customFontOptions(fonts, look.font)),
    onChange: (font) => editFont({ font }),
  });
  const fontSources = el(MapFontSources, { onPick: (font) => editFont({ font }) });
  const weightSelect = el(Select, {
    label: tr("Начертание"),
    className: "wmc-select",
    value: look.weight,
    options: labelWeightOptions(),
    onChange: (weight) => editor("Начертание подписей набора")({ weight }),
  });

  const sliders = SLIDERS.map(([field, caption, spoken, from, to, unit, step]) =>
    el(Slider, {
      label: tr(caption),
      ariaLabel: spoken && tr(spoken),
      value: current[field],
      min: from,
      max: to,
      unit,
      onChange: (value) => editor(step, propOf(field))({ [field]: value }),
    }),
  );

  const swatches = SWATCHES.filter(([, , , needsOutline]) => !needsOutline || outline > 0).map(
    ([field, caption, blank, , step]) => {
      const picker = el(ColorPicker, {
        label: tr(caption),
        size: "sm",
        value: look[field] || blank,
        onChange: (value) => editor(step, propOf(field))({ [field]: value }),
      });
      let note = tr("Обводка");
      if (field === "color") note = look.color ? tr("Свой цвет") : tr("Цвет как у всех");
      return el("span", { className: "wmc-color-line" }, picker, el("span", null, note));
    },
  );

  const caps = el(ToggleGrid, {
    className: "wmc-set-flags",
    label: tr("Регистр подписей набора"),
    options: [capsVariant()],
    values: look.caps ? ["caps"] : [],
    onToggle: (_value, on) =>
      editor(on ? "Подписи набора прописными" : "Подписи набора как написаны")({ caps: on }),
  });
  const reset = OWN_RULES.some((rule) => rule(look))
    ? el(
        Button,
        {
          variant: "ghost",
          size: "sm",
          onClick: () => editor("Подписи набора как у всех")(Object.fromEntries(DEFAULTS)),
        },
        tr("Как у всех"),
      )
    : null;

  return el(
    "div",
    {
      className: "wmc-set-type",
      role: "group",
      "aria-label": mapText("Подписи набора «{title}»", { title: group.title }),
    },
    fontSelect,
    fontSources,
    weightSelect,
    ...sliders,
    el("div", { className: "wmc-set-colors" }, ...swatches),
    el("div", { className: "wmc-set-type-foot" }, caps, reset),
  );
}
