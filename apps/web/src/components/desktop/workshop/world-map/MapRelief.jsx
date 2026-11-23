import { createElement as el, Fragment } from "react";
import { Mountains } from "../../../ui/icons.jsx";
import { TERRAIN_PRESETS } from "@modovik/vector-map";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { ColorLine, PanelSection } from "./MapPanelParts.jsx";
import { LightChoice, StepChoice } from "./MapChoicePictures.jsx";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { lowerFor, mapText } from "./map-copy.js";

// Стороны света для плиток: [азимут, русский ключ подписи]; порядок важен (при равенстве — первая).
const LIGHT_SIDES = [
  [270, "З"],
  [315, "СЗ"],
  [0, "С"],
  [45, "СВ"],
];

const CONTOUR_STEPS = [
  { value: "25", label: "25 м" },
  { value: "50", label: "50 м" },
  { value: "100", label: "100 м" },
];

const DEFAULT_STEP = "50";
const TINT_STARTS_AT = 55;
const COLORS = { low: "#3b4a36", high: "#c9c2b4", line: "#9aa3b2" };

// ---------- подпись строки «Рельеф» на первой странице колонки ----------

const CAPTION_PARTS = [
  [(b) => b.reliefShade > 0, () => tr("тени")],
  [(b) => b.reliefTint > 0, () => tr("цвет высот")],
  [(b) => b.reliefContours, () => tr("горизонтали")],
];

export function reliefCaption(base, vector) {
  if (!vector) return tr("Есть только у векторных карт");
  if (!base.reliefOn) return tr("Выключен");
  const parts = CAPTION_PARTS.filter(([applies]) => applies(base)).map(([, name]) => name());
  return parts.length > 0 ? mapText("Включён · {parts}", { parts: parts.join(", ") }) : tr("Включён");
}

// ---------- выключатель в шапке страницы ----------

export function ReliefSwitch({ base, patchBase }) {
  useTr();
  const flip = () => {
    const turnOn = !base.reliefOn;
    patchBase({ reliefOn: turnOn }, turnOn ? tr("Рельеф включён") : tr("Рельеф выключен"), "base.reliefOn");
  };
  return el(Switch, { checked: base.reliefOn, label: tr("Рельеф на карте"), onChange: flip });
}

// ---------- мелкие помощники ----------

// ближайшая сторона света по кратчайшей дуге; нечисло — первая в списке
function nearestSide(angle) {
  const start = { side: LIGHT_SIDES[0], gap: Infinity };
  return LIGHT_SIDES.reduce((best, side) => {
    const direct = Math.abs(angle - side[0]);
    const gap = Math.min(direct, Math.abs(direct - 360));
    return gap < best.gap ? { side, gap } : best;
  }, start).side;
}

const percentSlider = (label, value, [min, max, step], onChange) =>
  el(Slider, { label, value, min, max, step, unit: "%", onChange });

// строка цвета: хранится пустая строка — значит «как у карты», и показывается запасной цвет
function colorRow(patchBase, { title, stored, fallback, field, applied, cleared }) {
  return el(ColorLine, {
    label: title,
    value: stored || fallback,
    changed: Boolean(stored),
    onChange: (color) => patchBase({ [field]: color }, applied, `base.${field}`),
    onReset: () => patchBase({ [field]: "" }, cleared),
  });
}

const colorLines = (...rows) => el("div", { className: "wmc-color-lines" }, ...rows);

// ---------- разделы страницы ----------

function presetTile(preset, active, choose) {
  return el(
    "button",
    {
      key: preset.id,
      type: "button",
      role: "radio",
      "aria-checked": active,
      className: active ? "wmc-relief-preset is-active" : "wmc-relief-preset",
      onClick: choose,
    },
    el("i", { className: `wmc-relief-sample is-${preset.id}`, "aria-hidden": "true" }),
    el("small", null, tr(preset.title)),
  );
}

function presetSection(base, patchBase, lang) {
  const same = (patch) => Object.keys(patch).every((field) => base[field] === patch[field]);
  const current = base.reliefOn ? TERRAIN_PRESETS.find((preset) => same(preset.patch)) : undefined;
  const tiles = TERRAIN_PRESETS.map((preset) =>
    presetTile(preset, preset === current, () =>
      patchBase(
        { ...preset.patch, reliefOn: true },
        mapText("Рельеф: {name}", { name: lowerFor(lang, tr(preset.title)) }),
      ),
    ),
  );
  const group = el(
    "div",
    { className: "wmc-relief-presets", role: "radiogroup", "aria-label": tr("Готовый вид рельефа") },
    ...tiles,
  );
  const offHint = base.reliefOn
    ? null
    : el("small", { className: "wmc-hint" }, tr("Выберите вид или включите рельеф выключателем вверху."));
  return el(PanelSection, { key: "presets", title: tr("Готовый вид"), icon: el(Mountains) }, group, offHint);
}

function shadeSection(base, patchBase) {
  const lit = nearestSide(base.reliefLight);
  return el(
    PanelSection,
    { key: "shade", title: tr("Тени и свет") },
    percentSlider(tr("Сила"), base.reliefShade, [0, 100, 1], (value) =>
      patchBase({ reliefShade: value }, tr("Сила рельефа"), "base.reliefShade"),
    ),
    el("small", { className: "wmc-field-caption" }, tr("Свет падает с")),
    el(LightChoice, {
      label: tr("Свет падает с"),
      value: String(lit[0]),
      lights: LIGHT_SIDES,
      onChange: (angle) => patchBase({ reliefLight: Number(angle) }, tr("Свет рельефа"), "base.reliefLight"),
    }),
    percentSlider(tr("Высота гор"), base.reliefHeight, [30, 400, 5], (value) =>
      patchBase({ reliefHeight: value }, tr("Высота гор"), "base.reliefHeight"),
    ),
  );
}

function tintSection(base, patchBase) {
  const active = base.reliefTint > 0;
  const toggle = el(Switch, {
    checked: active,
    label: tr("Цвет по высоте"),
    onChange: (next) =>
      patchBase(
        { reliefTint: next ? TINT_STARTS_AT : 0 },
        next ? tr("Цвет по высоте") : tr("Без цвета высот"),
      ),
  });
  const frame = { key: "tint", title: tr("Цвет по высоте"), actions: toggle };
  if (!active) {
    return el(PanelSection, { ...frame, hint: tr("Горы светлее или темнее по высоте — как на атласе.") });
  }

  return el(
    PanelSection,
    frame,
    percentSlider(tr("Сила"), base.reliefTint, [5, 100, 1], (value) =>
      patchBase({ reliefTint: value }, tr("Цвет по высоте"), "base.reliefTint"),
    ),
    colorLines(
      colorRow(patchBase, {
        title: tr("Низины"),
        stored: base.reliefLow,
        fallback: COLORS.low,
        field: "reliefLow",
        applied: tr("Цвет низин"),
        cleared: tr("Цвет низин как у суши"),
      }),
      colorRow(patchBase, {
        title: tr("Вершины"),
        stored: base.reliefHigh,
        fallback: COLORS.high,
        field: "reliefHigh",
        applied: tr("Цвет вершин"),
        cleared: tr("Цвет вершин по карте"),
      }),
    ),
  );
}

function contourSection(base, patchBase) {
  const toggle = el(Switch, {
    checked: base.reliefContours,
    label: tr("Горизонтали"),
    onChange: (next) =>
      patchBase(
        { reliefContours: next },
        next ? tr("Горизонтали показаны") : tr("Горизонтали скрыты"),
        "base.reliefContours",
      ),
  });
  const frame = { key: "contours", title: tr("Горизонтали"), actions: toggle };
  if (!base.reliefContours) {
    return el(PanelSection, {
      ...frame,
      hint: tr("Линии равной высоты, каждая пятая толще — как на топокарте."),
    });
  }

  const known = CONTOUR_STEPS.find((step) => Number(step.value) === base.reliefStep);
  return el(
    PanelSection,
    frame,
    el(StepChoice, {
      label: tr("Шаг"),
      value: known ? known.value : DEFAULT_STEP,
      steps: CONTOUR_STEPS,
      onChange: (step) => patchBase({ reliefStep: Number(step) }, tr("Шаг горизонталей"), "base.reliefStep"),
    }),
    percentSlider(tr("Видимость"), base.reliefContourOpacity, [5, 100, 1], (value) =>
      patchBase({ reliefContourOpacity: value }, tr("Видимость горизонталей"), "base.reliefContourOpacity"),
    ),
    colorLines(
      colorRow(patchBase, {
        title: tr("Цвет линий"),
        stored: base.reliefContourColor,
        fallback: COLORS.line,
        field: "reliefContourColor",
        applied: tr("Цвет горизонталей"),
        cleared: tr("Цвет горизонталей по карте"),
      }),
    ),
  );
}

// ---------- страница ----------

const DETAIL_SECTIONS = [shadeSection, tintSection, contourSection];

export default function ReliefPage({ base, vector, patchBase }) {
  useTr();
  const lang = useUiLanguage();

  if (!vector) {
    return el(PanelSection, {
      hint: tr(
        "Рельеф рисуется у векторных карт — «Как в игре», «Атлас» и других из «Вида карты». У снимка он уже есть в самой картинке.",
      ),
    });
  }

  const rest = base.reliefOn ? DETAIL_SECTIONS.map((build) => build(base, patchBase)) : [];
  return el(Fragment, null, presetSection(base, patchBase, lang), ...rest);
}
