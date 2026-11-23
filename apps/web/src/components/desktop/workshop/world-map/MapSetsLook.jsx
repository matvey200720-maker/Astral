import { tr, useTr } from "../../../../locales/ui.js";
import { mapText } from "./map-copy.js";
import { createElement as el, Fragment, useReducer } from "react";
import { ZONE_PALETTES, paletteSwatch, recolorZones } from "@modovik/vector-map";
import Button from "../../../ui/Button.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { Shuffle } from "../../../ui/icons.jsx";
import LabelFontList from "./MapLabelFonts.jsx";
import { ColorLine } from "./MapPanelParts.jsx";
import { CaseChoice } from "./MapChoicePictures.jsx";
import { AlignChoice, FillChoice, ZoneSample } from "./MapLookPictures.jsx";

// Выбираются один раз при загрузке: девять палитр для кнопок и «случайная» отдельно.
const shelf = { listed: [], shuffle: null };
for (const palette of ZONE_PALETTES) {
  if (palette.id === "random") shelf.shuffle = palette;
  else shelf.listed.push(palette);
}

const SAMPLE_COLOR = "#ff5d72";

// ---------- общие помощники ----------

const either = (on, yes, no) => (on ? yes() : no());

function sliderRow(label, value, [min, max, step], onChange, unit) {
  return el(Slider, { label, value, min, max, step, unit, onChange });
}

function switchLine(caption, props) {
  return el(
    "label",
    { className: "ui-field wmc-switch-line" },
    el("span", null, caption),
    el(Switch, props),
  );
}

// Записывает раздел целиком: { [name]: { ...старый раздел, [field]: value } }
function sectionWriter(name, section, onSection) {
  return (field, value, caption) => {
    const patch = { [name]: Object.assign({}, section, { [field]: value }) };
    onSection(patch, caption, `${name}.${field}`);
  };
}

// ---------- подписи: вид всех подписей ----------

const fontsPart = (markers, write) =>
  el(LabelFontList, {
    value: markers.font,
    emptyLabel: "Astral",
    label: tr("Шрифт всех подписей"),
    onChange: (font) => write("font", font || "astral", tr("Шрифт подписей")),
  });

const sizePart = (markers, write) =>
  sliderRow(tr("Размер"), markers.labelSize, [6, 64, 0.5], (size) =>
    write("labelSize", size, tr("Размер подписей")),
  );

const autoPart = (markers, write) =>
  switchLine(tr("Цвет по фону"), {
    checked: markers.labelAuto,
    label: tr("Цвет подписей по фону"),
    onChange: (on) =>
      write(
        "labelAuto",
        on,
        either(on, () => tr("Цвет подписей по фону"), () => tr("Цвет подписей вручную")),
      ),
  });

function tonePart(markers, write) {
  const lines = [
    el(ColorLine, {
      label: markers.labelAuto ? tr("Оттенок подписей") : tr("Цвет подписей"),
      value: markers.labelColor,
      onChange: (color) => write("labelColor", color, tr("Цвет подписей")),
    }),
  ];
  if (!markers.labelAuto) {
    lines.push(
      el(ColorLine, {
        label: tr("Обводка"),
        value: markers.labelOutlineColor,
        onChange: (color) => write("labelOutlineColor", color, tr("Обводка подписей")),
      }),
    );
  }
  return el("div", { className: "wmc-color-lines" }, ...lines);
}

const casePart = (markers, write) =>
  el(CaseChoice, {
    value: markers.labelCase === "upper" ? "upper" : "as-is",
    onChange: (kind) =>
      write("labelCase", kind === "upper" ? "upper" : "original", tr("Регистр подписей")),
  });

const LABEL_PARTS = [fontsPart, sizePart, autoPart, tonePart, casePart];

export function LabelsLook({ config, onSection }) {
  useTr();
  const { markers } = config;
  const write = sectionWriter("markers", markers, onSection);
  return el(Fragment, null, ...LABEL_PARTS.map((part) => part(markers, write)));
}

// ---------- зоны: вид всех зон ----------

function densityCaption(mode) {
  if (mode === "recolor") return tr("Сила перекраски");
  return tr("Плотность");
}

function alignCaption(align) {
  if (align === "inside") return tr("Граница внутрь зоны");
  return tr("Граница по контуру");
}

const samplePart = ({ zones }) => [el(ZoneSample, { look: zones, color: SAMPLE_COLOR })];

const fillPart = ({ zones, write }) => [
  el(FillChoice, {
    label: tr("Заливка"),
    value: zones.fillMode,
    color: SAMPLE_COLOR,
    none: false,
    onChange: (mode) => write("fillMode", mode, tr("Заливка зон")),
  }),
  sliderRow(
    densityCaption(zones.fillMode),
    zones.fillOpacity,
    [0, 100, 1],
    (value) => write("fillOpacity", value, tr("Заливка зон")),
    "%",
  ),
];

const outlinePart = ({ zones, write }) => [
  sliderRow(tr("Граница"), zones.strokeWidth, [0, 16, 0.1], (value) =>
    write("strokeWidth", value, tr("Граница зон")),
  ),
  el(AlignChoice, {
    label: tr("Где граница"),
    value: zones.strokeAlign,
    color: SAMPLE_COLOR,
    onChange: (align) => write("strokeAlign", align, alignCaption(align)),
  }),
  sliderRow(
    tr("Свечение"),
    zones.glow,
    [0, 100, 1],
    (value) => write("glow", value, tr("Свечение зон")),
    "%",
  ),
];

function labelsPart({ zones, write }) {
  const parts = [
    switchLine(tr("Подписи зон"), {
      checked: zones.labels,
      label: tr("Подписи зон"),
      onChange: (on) => write("labels", on, tr("Подписи зон")),
    }),
  ];
  if (!zones.labels) return parts;
  parts.push(
    switchLine(tr("Цвет подписей по фону"), {
      checked: zones.labelAuto,
      label: tr("Цвет подписей зон по фону"),
      onChange: (on) =>
        write(
          "labelAuto",
          on,
          either(on, () => tr("Подписи зон по фону"), () => tr("Подписи зон вручную")),
        ),
    }),
    switchLine(tr("Подпись цветом зоны"), {
      checked: zones.labelTint,
      label: tr("Подпись цветом зоны"),
      onChange: (on) => write("labelTint", on, tr("Цвет подписей зон")),
    }),
  );
  return parts;
}

function paletteButton(palette, pick) {
  const name = tr(palette.title);
  return el(
    "button",
    {
      key: palette.id,
      type: "button",
      className: "wmc-palette",
      title: name,
      "aria-label": mapText("Раскрасить все зоны: {name}", { name }),
      onClick: () => pick(palette.id),
    },
    el(
      "span",
      { className: "wmc-palette-strip", "aria-hidden": "true" },
      paletteSwatch(palette.id).map((color) =>
        el("i", { key: color, style: { background: color } }),
      ),
    ),
    el("small", null, name),
  );
}

function palettesPart({ zones, recolor }) {
  if (zones.items.length === 0) return [];
  const group = el(
    "div",
    { className: "wmc-palettes", role: "group", "aria-label": tr("Раскраска всех зон") },
    shelf.listed.map((palette) => paletteButton(palette, recolor)),
  );
  const parts = [el("small", { className: "wmc-field-caption" }, tr("Раскрасить все зоны")), group];
  if (shelf.shuffle) {
    const luck = {
      variant: "secondary",
      size: "sm",
      block: true,
      icon: el(Shuffle),
      onClick: () => recolor(shelf.shuffle.id),
    };
    parts.push(el(Button, luck, tr("Случайные цвета")));
  }
  return parts;
}

const ZONE_PARTS = [samplePart, fillPart, outlinePart, labelsPart, palettesPart];

export function ZonesLook({ config, onConfig, onSection }) {
  useTr();
  const [seed, bump] = useReducer((count) => count + 1, 1);
  const { zones } = config;

  // зерно растёт на единицу при каждой раскраске; первый щелчок берёт зерно 2
  const recolor = (paletteId) => {
    bump();
    onConfig(recolorZones(config, paletteId, { seed: seed + 1 }), tr("Раскраска всех зон"));
  };

  const kit = { zones, write: sectionWriter("zones", zones, onSection), recolor };
  return el(Fragment, null, ...ZONE_PARTS.flatMap((part) => part(kit)));
}
