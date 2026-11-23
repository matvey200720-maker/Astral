import { createElement as h, useId } from "react";
import { PictureChoice } from "./MapLookPictures.jsx";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { compassFor, mapText } from "./map-copy.js";

// ---- общие кубики рисунков 56x36 ----
const GROUND = "#4c5449";
const AUDIT_OFF = "caps type-min type-scale";

const ground = () => h("rect", { width: 56, height: 36, fill: GROUND });
const frame = (extra, parts) =>
  h("svg", { viewBox: "0 0 56 36", "aria-hidden": "true", ...extra }, ...parts);
const pick = (label, value, options, onChange) =>
  h(PictureChoice, { label, value, options, onChange });

// ---- регистр ----
const CASE_TILES = [
  ["as-is", "Как написано", "Абв"],
  ["upper", "Прописными", "АБВ"],
];

function caseSketch(word) {
  const lettering = {
    x: 28,
    y: 23,
    textAnchor: "middle",
    fontSize: 14,
    fontWeight: 800,
    fill: "#fff",
    stroke: "#0b0d10",
    strokeWidth: 2.4,
    paintOrder: "stroke",
    "data-audit-ignore": AUDIT_OFF,
  };
  return frame({ "data-audit-ignore": AUDIT_OFF }, [ground(), h("text", lettering, word)]);
}

export function CaseChoice({ label, value, onChange }) {
  useTr();
  const options = CASE_TILES.map(([id, name, sample]) => ({
    value: id,
    label: tr(name),
    picture: caseSketch(tr(sample)),
  }));
  return pick(label === undefined ? tr("Регистр") : label, value, options, onChange);
}

// ---- свет ----
const HILL_STOPS = [
  [0, "#c9cfbf"],
  [0.55, "#6f7a66"],
  [1, "#262b23"],
];

function Hill({ angle }) {
  const gradientId = "hill-" + useId().replace(/[^\w-]/g, "");
  const rad = (Number(angle) * Math.PI) / 180;
  const [dx, dy] = [Math.sin(rad), -Math.cos(rad)];
  const gradient = h(
    "radialGradient",
    { id: gradientId, cx: `${50 + dx * 28}%`, cy: `${50 + dy * 28}%`, r: "70%" },
    ...HILL_STOPS.map(([offset, stopColor]) => h("stop", { key: offset, offset, stopColor })),
  );
  return frame({}, [
    h("defs", null, gradient),
    ground(),
    h("ellipse", { cx: 28, cy: 20, rx: 15, ry: 11, fill: `url(#${gradientId})` }),
    h("circle", { cx: 28 + dx * 22, cy: 18 + dy * 13, r: 3.2, fill: "#ffd66b" }),
  ]);
}

export function LightChoice({ label, value, lights, onChange }) {
  useTr();
  const names = compassFor(useUiLanguage());
  const options = lights.map(([angle, side]) => {
    const caption = names[side] || side;
    return {
      value: String(angle),
      label: caption,
      hint: mapText("Свет падает с {caption}", { caption }),
      picture: h(Hill, { angle }),
    };
  });
  return pick(label, value, options, onChange);
}

// ---- шаг горизонталей ----
const RING_LIMITS = [
  [25, 6],
  [50, 4],
];
const OUTER_RINGS = 2;

function ringsSketch(stepValue) {
  const size = Number(stepValue);
  const total = (RING_LIMITS.find(([limit]) => size <= limit) || [0, OUTER_RINGS])[1];
  const rings = Array.from({ length: total }, (_, i) => {
    const k = (i + 1) / total;
    return h("ellipse", {
      key: i,
      cx: 28,
      cy: 19,
      rx: 4 + 18 * k,
      ry: 3 + 12 * k,
      fill: "none",
      stroke: "#d9dccf",
      strokeOpacity: 0.85,
      strokeWidth: 1,
    });
  });
  return frame({}, [ground(), ...rings]);
}

export function StepChoice({ label, value, steps, onChange }) {
  useTr();
  const options = steps.map((step) => ({
    ...step,
    label: tr(step.label),
    picture: ringsSketch(step.value),
  }));
  return pick(label, value, options, onChange);
}

// ---- чёткость ----
const CELL_BY_LEVEL = [
  [4, 1.5],
  [2, 3],
];
const DEFAULT_CELL = 6;

function stairsSketch(levelValue) {
  const level = Number(levelValue);
  const cell = (CELL_BY_LEVEL.find(([floor]) => level >= floor) || [0, DEFAULT_CELL])[1];
  const blocks = Array.from({ length: Math.ceil(56 / cell) }, (_, i) => {
    const x = i * cell;
    return h("rect", {
      key: x,
      x,
      y: Math.round((30 - x * 0.45) / cell) * cell,
      width: cell,
      height: cell * 1.6,
      fill: "#9aa0a6",
    });
  });
  return frame({ shapeRendering: "crispEdges" }, [ground(), ...blocks]);
}

export function DetailChoice({ label, value, levels, costs = null, onChange }) {
  useTr();
  const options = levels.map((level, at) => {
    const name = tr(level.label);
    const price = costs && costs[at];
    return {
      value: level.value,
      label: name,
      ...(price ? { hint: `${name} — ${price}`, detail: price } : null),
      picture: stairsSketch(level.value),
    };
  });
  return pick(label, value, options, (picked) => onChange(Number(picked)));
}
