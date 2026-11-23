import { createElement as h, Fragment, useId } from "react";
import {
  FONT_FAMILIES,
  GLYPH_BOX,
  MAP_FONTS,
  MARKER_CATEGORY_MAP,
  WEIGHTS,
  glyphPath,
  unitShapePoints,
} from "@modovik/vector-map";
import { tr, useTr } from "../../../../locales/ui.js";

export const DEMO_W = 160;
export const DEMO_H = 64;

const INK = "#0c0f12";
const WHITE = "#ffffff";

// Крошечный конструктор: [тег, свойства, ...дети] -> элемент.
const node = (tag, props, ...kids) => h(tag, props, ...kids);
const stopAt = (offset, color, opacity) =>
  node("stop", { offset, stopColor: color, ...(opacity === undefined ? {} : { stopOpacity: opacity }) });

// Берег и дороги: одна строка пути на все три слоя берега.
const COAST = "M0 0H116C109 9 121 17 114 27C107 37 124 44 118 54C115 59 119 64 119 64H0Z";
const WOODS =
  "M8 6C22 2 34 10 30 18C26 25 12 24 7 17C4 12 4 8 8 6ZM74 8C88 4 98 12 92 19C86 25 72 20 70 14C69 11 71 9 74 8Z";
const SIDE_ROADS = [
  "M36 -2C39 16 33 30 43 66",
  "M64 66C68 54 62 46 72 41",
  "M0 22C14 24 22 18 37 20",
];
const MAIN_ROAD = "M-2 47C26 41 54 53 82 40C96 33 106 30 117 25";
const COAST_LAYERS = [
  { stroke: "#7cc4ec", strokeOpacity: 0.28, strokeWidth: 7 },
  { stroke: "#e2cf96", strokeOpacity: 0.85, strokeWidth: 1.6 },
];

function gradients(id) {
  return node(
    "defs",
    null,
    node("linearGradient", { id: `sea-${id}`, x1: 0, y1: 0, x2: 1, y2: 1 }, stopAt(0, "#2f6b8c"), stopAt(1, "#1c3c52")),
    node("linearGradient", { id: `land-${id}`, x1: 0, y1: 0, x2: 0.4, y2: 1 }, stopAt(0, "#5d7c46"), stopAt(1, "#465f37")),
    node(
      "radialGradient",
      { id: `vignette-${id}`, cx: 0.5, cy: 0.45, r: 0.75 },
      stopAt(0.6, "#000", 0),
      stopAt(1, "#000", 0.38),
    ),
  );
}

export function DemoGround({ id }) {
  const coastLines = COAST_LAYERS.map((layer, i) =>
    node("path", { key: i, d: COAST, fill: "none", ...layer }),
  );
  const roads = [
    ...SIDE_ROADS.map((d, i) =>
      node("path", { key: i, d, stroke: "#cfd6dc", strokeOpacity: 0.55, strokeWidth: 0.9 }),
    ),
    node("path", { key: "shade", d: MAIN_ROAD, stroke: "#1d2226", strokeOpacity: 0.55, strokeWidth: 3.8 }),
    node("path", { key: "line", d: MAIN_ROAD, stroke: "#eef1f3", strokeWidth: 2.2 }),
  ];
  return h(
    Fragment,
    null,
    gradients(id),
    node("rect", { width: DEMO_W, height: DEMO_H, fill: `url(#sea-${id})` }),
    ...coastLines,
    node("path", { d: COAST, fill: `url(#land-${id})` }),
    node("path", { d: WOODS, fill: "#6f8f56", opacity: 0.55 }),
    node("g", { fill: "none", strokeLinecap: "round" }, ...roads),
  );
}

// Номер кадра без знаков, кроме букв и цифр; useTr держит подписи свежими.
function useFrame() {
  useTr();
  return useId().replace(/[^a-zA-Z0-9]/g, "");
}

function frame(kind, name, key, ...parts) {
  return node(
    "div",
    { className: `wmc-tool-demo ${kind}`, role: "img", "aria-label": name },
    node(
      "svg",
      {
        viewBox: `0 0 ${DEMO_W} ${DEMO_H}`,
        preserveAspectRatio: "xMidYMid slice",
        "aria-hidden": "true",
        focusable: "false",
      },
      h(DemoGround, { id: key }),
      ...parts,
      node("rect", { width: DEMO_W, height: DEMO_H, fill: `url(#vignette-${key})`, pointerEvents: "none" }),
    ),
  );
}

const num = (v) => Number(v) || 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- кисть ----------

const BRUSH_PATH = "M14 44C40 8 74 58 104 26C120 10 138 16 148 30";
const BRUSH_DASH = {
  dashed: (w) => `${w * 2.4} ${w * 1.6}`,
  dotted: (w) => `0 ${w * 1.8}`,
};

export function BrushDemo({ brush }) {
  const key = useFrame();
  const width = clamp(num(brush.size) / 30, 1.5, 26);
  const soft = clamp(num(brush.softness), 0, 100);
  const pattern = BRUSH_DASH[brush.line];
  const blur =
    soft > 0
      ? node(
          "defs",
          null,
          node(
            "filter",
            { id: `soft-${key}`, x: "-20%", y: "-60%", width: "140%", height: "220%" },
            node("feGaussianBlur", { stdDeviation: (width * soft) / 220 }),
          ),
        )
      : null;
  const stroke = node("path", {
    className: "wmc-demo-draw",
    pathLength: 1,
    d: BRUSH_PATH,
    fill: "none",
    stroke: brush.color,
    strokeOpacity: num(brush.opacity) / 100,
    strokeWidth: width,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeDasharray: pattern ? pattern(width) : undefined,
    filter: soft > 0 ? `url(#soft-${key})` : undefined,
  });
  return frame("is-brush", tr("Так ляжет линия кисти"), key, blur, stroke);
}

// ---------- значки (общий кусок для ластика и «Значков») ----------

function badge(cat, size, caption) {
  const color = cat.color || WHITE;
  // Пиктограмма есть, только если для неё нашёлся путь; иначе рисуется кружок.
  const shape = cat.glyph && cat.glyph !== "none" ? glyphPath(cat.glyph) : null;
  const drawn = shape
    ? node("path", {
        d: shape,
        transform: `scale(${size / GLYPH_BOX}) translate(${-GLYPH_BOX / 2} ${-GLYPH_BOX / 2})`,
        fill: color,
        stroke: INK,
        strokeWidth: 34,
        strokeLinejoin: "round",
        paintOrder: "stroke",
      })
    : node("circle", { r: size / 4, fill: color, stroke: INK, strokeWidth: 1.2 });
  const text = caption
    ? node(
        "text",
        {
          "data-audit-ignore": "type-min type-scale caps",
          x: size / 2 + 2.5,
          y: 2.3,
          fontSize: 6.5,
          className: "wmc-demo-label",
          fill: WHITE,
          stroke: INK,
          strokeWidth: 1.6,
          strokeLinejoin: "round",
          paintOrder: "stroke",
        },
        caption,
      )
    : null;
  return [drawn, text];
}

// ---------- ластик ----------

const ERASE_TRAIL = "M10 50L150 16";
const ERASE_HITS = [
  {
    cls: "is-hit-2",
    at: "translate(75.8 32.02)",
    cat: () => MARKER_CATEGORY_MAP.fuel,
    caption: () => tr("АЗС"),
  },
  {
    cls: "is-hit-3",
    at: "translate(119.2 23.48)",
    cat: () => MARKER_CATEGORY_MAP.medic,
    caption: () => null,
  },
];

export function EraserDemo({ size }) {
  const key = useFrame();
  const metres = clamp(num(size) || 160, 8, 4000);
  const thick = 5 + 21 * (Math.log(metres / 8) / Math.log(500));
  const hits = ERASE_HITS.map((hit) =>
    node(
      "g",
      { key: hit.cls, className: `wmc-demo-hit ${hit.cls}` },
      node("g", { transform: hit.at }, ...badge(hit.cat(), 11, hit.caption())),
    ),
  );
  return frame(
    "is-eraser",
    tr("Ластик стирает всё, чего коснулся"),
    key,
    node("path", {
      className: "wmc-demo-erase-trail",
      d: ERASE_TRAIL,
      pathLength: 1,
      fill: "none",
      stroke: WHITE,
      strokeOpacity: 0.12,
      strokeWidth: thick,
      strokeLinecap: "round",
    }),
    node("path", {
      className: "wmc-demo-hit is-hit-1",
      d: "M14 22C24 12 34 30 44 38C50 43 56 46 62 44",
      fill: "none",
      stroke: "#ff5d73",
      strokeWidth: 3.2,
      strokeLinecap: "round",
    }),
    ...hits,
    node(
      "g",
      {
        className: "wmc-demo-eraser",
        style: { "--from-x": "10px", "--from-y": "50px", "--to-x": "150px", "--to-y": "16px" },
      },
      node("circle", { r: thick / 2, fill: WHITE, fillOpacity: 0.16, stroke: WHITE, strokeWidth: 1 }),
    ),
  );
}

// ---------- надпись ----------

export function TextDemo({ style = {}, sample, fontFamily }) {
  const key = useFrame();
  // Первым из style читается font (при style = null отсюда и падение).
  const css = {
    fontFamily: fontFamily || FONT_FAMILIES[style.font] || MAP_FONTS[0].family,
    fontWeight: WEIGHTS[style.weight] || 800,
    fontSize: "15px",
    letterSpacing: `${num(style.letterSpacing) / 100}em`,
  };
  const outline = Number(style.outline);
  const glow = Number(style.glow);
  const inked = outline > 0;
  if (glow > 0) css.filter = `drop-shadow(0 0 ${(glow / 10).toFixed(1)}px ${style.glowColor || WHITE})`;
  return frame(
    "is-text",
    tr("Так встанет надпись"),
    key,
    node(
      "defs",
      null,
      node("clipPath", { id: `type-${key}` }, node("rect", { className: "wmc-demo-type", width: DEMO_W, height: DEMO_H })),
    ),
    node("circle", { className: "wmc-demo-click", cx: 80, cy: 33, r: 7, fill: "none", stroke: WHITE, strokeWidth: 1 }),
    node(
      "text",
      {
        "data-audit-ignore": "type-min type-scale caps",
        x: 80,
        y: 33,
        clipPath: `url(#type-${key})`,
        textAnchor: "middle",
        dominantBaseline: "central",
        fill: style.color || WHITE,
        stroke: inked ? style.outlineColor || INK : "none",
        strokeWidth: inked ? outline / 28 : 0,
        strokeLinejoin: "round",
        paintOrder: "stroke",
        style: css,
      },
      sample || tr("Надпись"),
    ),
  );
}

// ---------- значки ----------

const DROP_SPOTS = [
  [20, 21],
  [60, 45],
  [96, 17],
];
const TRAILING_NUMBER = /(\d+)$/;

export function markerDemoLabels(label, fallback) {
  const text = String(label || "").trim();
  const tail = TRAILING_NUMBER.exec(text);
  if (!tail) return Array.from({ length: 3 }, () => text || fallback);
  const head = text.slice(0, tail.index);
  const first = Number(tail[1]);
  return [0, 1, 2].map((step) => head + (first + step));
}

export function MarkerDemo({ category, label }) {
  const key = useFrame();
  const found = MARKER_CATEGORY_MAP[category];
  const cat = found || MARKER_CATEGORY_MAP.fuel;
  const captions = markerDemoLabels(label, found ? tr(found.title) : "");
  const drops = DROP_SPOTS.map(([x, y], i) =>
    node(
      "g",
      { key: i, className: "wmc-demo-drop", style: { "--i": i } },
      node("g", { transform: `translate(${x} ${y})` }, ...badge(cat, 12, captions[i])),
    ),
  );
  return frame("is-markers", tr("Так встанут значки"), key, ...drops);
}

// ---------- фигура ----------

const FREE_SHAPE = [
  { x: -0.5, y: -0.1 },
  { x: -0.2, y: -0.5 },
  { x: 0.35, y: -0.38 },
  { x: 0.5, y: 0.12 },
  { x: 0.1, y: 0.5 },
  { x: -0.38, y: 0.36 },
];
const SHAPE_DASH = {
  dashed: (w) => `${w * 2.6} ${w * 1.8}`,
  dotted: (w) => `0.01 ${w * 2.2}`,
};

// Пустой результат (нет длины) — пустой путь; у не-массива с длиной (строка) .map не найдётся.
function outlineOf(points) {
  if (!points.length) return "";
  const steps = points.map((p, i) => {
    const at = `${(80 + p.x * 46).toFixed(2)} ${(32 + p.y * 40).toFixed(2)}`;
    return (i ? "L" : "M") + at;
  });
  return steps.join("") + "Z";
}

export function ShapeDemo({ shape = "rect", line = "solid", fill = false, color = "#ff5d73", width = 2 }) {
  const key = useFrame();
  const points = shape === "free" ? FREE_SHAPE : unitShapePoints(shape);
  const ink = color || "#ff5d73";
  const weight = clamp(width * 0.3 + 0.6, 0.8, 4.5);
  const pattern = SHAPE_DASH[line];
  return frame(
    "is-shapes",
    tr("Так ляжет фигура"),
    key,
    node(
      "g",
      { className: "wmc-demo-stretch" },
      node("path", {
        d: outlineOf(points),
        fill: fill ? ink : "none",
        fillOpacity: fill ? 0.3 : undefined,
        stroke: ink,
        strokeWidth: weight,
        strokeDasharray: pattern ? pattern(weight) : undefined,
        strokeLinecap: line === "dotted" ? "round" : "butt",
        strokeLinejoin: "round",
        vectorEffect: "non-scaling-stroke",
      }),
    ),
    node("path", {
      className: "wmc-demo-pointer",
      d: "M0 0L0 8.5L2.3 6.4L3.9 10L5.4 9.3L3.8 5.9L6.9 5.6Z",
      fill: WHITE,
      stroke: INK,
      strokeWidth: 0.8,
      strokeLinejoin: "round",
    }),
  );
}

// ---------- картинка ----------

const HANDLES = [
  [57, 9],
  [99, 9],
  [57, 51],
  [99, 51],
];

export function ImageDemo() {
  const key = useFrame();
  const handles = HANDLES.map(([x, y]) =>
    node("rect", { key: `${x}-${y}`, x, y, width: 4, height: 4, rx: 0.8, fill: WHITE, stroke: INK, strokeWidth: 0.6 }),
  );
  return frame(
    "is-images",
    tr("Картинка встаёт поверх карты в рамке с ручками"),
    key,
    node(
      "g",
      { className: "wmc-demo-picture" },
      node(
        "defs",
        null,
        node(
          "linearGradient",
          { id: `logo-${key}`, x1: 0, y1: 0, x2: 1, y2: 1 },
          stopAt(0, "#ffd36e"),
          stopAt(1, "#ff6a3d"),
        ),
      ),
      node("rect", { x: 62, y: 14, width: 36, height: 36, rx: 8, fill: `url(#logo-${key})` }),
      node("path", {
        d: "M80 21L83.4 28.6L91.6 29.4L85.4 34.9L87.2 43L80 38.8L72.8 43L74.6 34.9L68.4 29.4L76.6 28.6Z",
        fill: WHITE,
      }),
      node("rect", { x: 59, y: 11, width: 42, height: 42, rx: 2, fill: "none", stroke: WHITE, strokeWidth: 0.8 }),
      node("line", { x1: 80, y1: 11, x2: 80, y2: 5, stroke: WHITE, strokeWidth: 0.8 }),
      node("circle", { cx: 80, cy: 4, r: 1.8, fill: WHITE }),
      ...handles,
    ),
  );
}
