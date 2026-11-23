import { createElement as make, Fragment, useEffect, useId, useRef, useState } from "react";
import { paintTarget } from "./tool-demo-kinds.js";

export const REPLAY_GAP_MS = 1500;
export const DEMO_W = 160;
export const DEMO_H = 64;

const TEAL = "#4fbfb4";
const WHITE = "#ffffff";
const AUDIT_SKIP = "type-min type-scale caps";
const STAR = "M0 -6.5L1.9 -2L6.6 -1.6L3 1.5L4.1 6.2L0 3.7L-4.1 6.2L-3 1.5L-6.6 -1.6L-1.9 -2Z";
const FALLBACK_ROUTE = "M18 46C40 14 70 54 96 26C112 10 132 18 144 32";
const SOLID_TARGETS = ["craft", "box", "sign", "lines", "cross", "bars", "clouds"];
const TINTS = ["#4fbfb4", "#d9a54e", "#a58cf0"];
const SPARK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const LETTER_TOOLS = ["text", "emblem"];

// ---------------------------------------------------------------------------
// Узлы. Рисунок описан таблицами «тег, атрибуты, дети»; одна функция делает из
// них элементы. Имена атрибутов записаны как в SVG, к именам React они
// приводятся здесь. Массив, который начинается не со строки, — список с
// ключами (React сам проверяет в нём повторы).
// ---------------------------------------------------------------------------

const attrNames = new Map();

const reactAttr = (name) => {
  if (!attrNames.has(name)) {
    let mapped = name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (name === "class") mapped = "className";
    if (/^(?:aria|data)-/.test(name)) mapped = name;
    attrNames.set(name, mapped);
  }
  return attrNames.get(name);
};

const build = (node) => {
  if (!Array.isArray(node)) return node;
  if (typeof node[0] !== "string") return node.map((item) => build(item));
  const [tag, attrs, ...kids] = node;
  const props = {};
  Object.keys(attrs).forEach((name) => {
    props[reactAttr(name)] = attrs[name];
  });
  return make(tag, props, ...kids.map((kid) => build(kid)));
};

// Компонент-«сцена»: план (props → узлы) в виде фрагмента.
const planned = (plan) =>
  function Planned(props) {
    return make(Fragment, null, ...plan(props).map((node) => build(node)));
  };

const box = (x, y, w, h) => ({ x, y, w, h });
const dot = (x, y) => ({ x, y });
const trace = (...segs) => segs.map(([cmd, ...nums]) => cmd + nums.join(" ")).join("");
const around = (x, y, w, h, m) => ({ x: x - m, y: y - m, width: w + 2 * m, height: h + 2 * m });
const midOf = (start, size) => start + size / 2;
const variantOf = (table, variant) =>
  typeof variant === "string" && Object.hasOwn(table, variant) ? table[variant] : undefined;

const slab = (d, fill) => ["path", { d, fill }];
const stop = (offset, color, opacity) => [
  "stop",
  { offset, "stop-color": color, ...(opacity !== undefined && { "stop-opacity": opacity }) },
];
const gradient = (kind, attrs, stops) => [
  "defs",
  {},
  [kind, attrs, ...stops.map((s) => stop(...s))],
];
const vertical = (id, stops) =>
  gradient("linearGradient", { id, x1: "0", y1: "0", x2: "0", y2: "1" }, stops);
const diagonal = (id, stops) =>
  gradient("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "1" }, stops);
const halo = (id, cy, r, stops) => gradient("radialGradient", { id, cx: "0.5", cy, r }, stops);
const wash = (fill) => ["rect", { width: DEMO_W, height: DEMO_H, fill }];
const click = (x, y) => [
  "circle",
  { class: "tdm-click", cx: x, cy: y, r: "6", fill: "none", stroke: WHITE, "stroke-width": "0.9" },
];

// ---------------------------------------------------------------------------
// Ствол с контуром из игры: якоря считаются из размеров контура.
// ---------------------------------------------------------------------------

const ROUTE_KNOTS = [
  [0.3, -4],
  [0.55, 4],
  [0.88, -1],
];

const weaponFromShape = (shape) => {
  const scale = Math.min(140 / shape.width, 44 / shape.height);
  const [w, h] = [shape.width, shape.height].map((side) => side * scale);
  const centered = (room, size, start) => start + (room - size) / 2;
  const x = centered(160, w, 0);
  const y = centered(46, h, 10);
  const mid = y + h * 0.42;
  const along = (share) => x + w * share;
  const tenth = (v) => v.toFixed(1);
  return {
    body: shape.path,
    bodyTransform: `translate(${tenth(x)} ${tenth(y)}) scale(${scale.toFixed(5)})`,
    frame: box(along(0.3), mid - 3.5, w * 0.28, 7),
    spot: dot(along(0.45), mid),
    object: box(along(0.3), y + 1, w * 0.32, Math.min(10, h * 0.32)),
    route: trace(
      ["M", tenth(along(0.06)), tenth(mid + 2)],
      ["C", ...ROUTE_KNOTS.flatMap(([share, dy]) => [tenth(along(share)), tenth(mid + dy)])],
    ),
    lights: [[along(0.95), mid]],
  };
};

// ---------------------------------------------------------------------------
// Вырезка краски по цели: буквы сцены, собственный путь цели или корпус.
// ---------------------------------------------------------------------------

const glyphText = (g, cls, fill) => [
  "text",
  {
    "data-audit-ignore": AUDIT_SKIP,
    class: cls,
    x: g.x,
    y: g.y,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "font-size": g.size,
    "font-weight": "800",
    textLength: g.width,
    lengthAdjust: "spacingAndGlyphs",
    ...(fill && { fill }),
  },
  g.text,
];

const cutOut = (key, a) => {
  if (key === "craft" && a.glyphs) return [glyphText(a.glyphs, "tdm-word")];
  if (key !== "body" && a[key]) return [["path", { d: a[key], "clip-rule": "evenodd" }]];
  return [["path", { d: a.body, transform: a.bodyTransform, "clip-rule": "evenodd" }]];
};

const paintKey = (target, toolId) => target || paintTarget(toolId);

const clipDefs = (name, id, key, a, ...more) => [
  "defs",
  {},
  ["clipPath", { id: `${name}-${id}` }, ...cutOut(key, a)],
  ...more,
];

// ---------------------------------------------------------------------------
// Действия. Каждое читает свой якорь сцены; `onObject`, `onFrame` и `onSpot`
// отдают рисующей функции нужный якорь (с пустым якорем она падает сама).
// ---------------------------------------------------------------------------

const onObject = (draw) => planned(({ id, anchors }) => draw(anchors.object, id));
const onFrame = (draw) => planned(({ id, anchors }) => draw(anchors.frame, id));
const onSpot = (draw) => planned(({ id, anchors }) => draw(anchors.spot, id, anchors));

const rimmed = (cls, { x, y, w, h }, extra) => [
  "rect",
  { class: cls, ...around(x, y, w, h, 1.5), ...extra },
];

const sparkle = (angle, i, x, y) => {
  const rad = (angle * Math.PI) / 180;
  return [
    "circle",
    {
      class: "tdm-spark",
      cx: x,
      cy: y,
      r: "1.2",
      fill: TEAL,
      style: { "--dx": `${Math.cos(rad) * 9}px`, "--dy": `${Math.sin(rad) * 9}px`, "--i": i },
    },
  ];
};

const ARMS = [
  ["is-up", 0, -1],
  ["is-down", 0, 1],
  ["is-left", -1, 0],
  ["is-right", 1, 0],
];

// Вверх и влево — вычитание, вниз и вправо — сложение (для строк это конкатенация).
const shift = (v, sign, n) => (sign > 0 ? v + n : v - n);

const armPath = (dx, dy, x, y) =>
  dx
    ? trace(["M", shift(x, dx, 4), y], ["H", shift(x, dx, 9)])
    : trace(["M", x, shift(y, dy, 4)], ["V", shift(y, dy, 9)]);

const pairAt = (route, pattern) => pattern.exec(route).slice(1).map(Number);

// Кегль надписи и поле вокруг неё: у сцены может быть своё слово.
const inkBox = (word) => ({
  size: word.size || 11,
  half: (word.width || 48) / 2 + 4,
});

const glowRing = (x, y, r, fill, fillOpacity) => [
  "circle",
  { cx: x, cy: y, r, fill, ...(fillOpacity && { "fill-opacity": fillOpacity }) },
];

const OBJECT_ACTIONS = {
  move: onObject(({ x, y, w, h }) => {
    const [cx, cy] = [midOf(x, w), midOf(y, h)];
    return [
      [
        "g",
        { class: "tdm-move" },
        rimmed(undefined, { x, y, w, h }, {
          rx: "1",
          fill: WHITE,
          "fill-opacity": "0.08",
          stroke: WHITE,
          "stroke-width": "0.9",
        }),
        [
          "path",
          {
            d: trace(
              ["M", cx - 5, cy],
              ["H", cx + 5],
              ["M", cx + 2.5, cy - 2.5],
              ["L", cx + 5, cy],
              ["L", cx + 2.5, cy + 2.5],
              ["M", cx - 2.5, cy - 2.5],
              ["L", cx - 5, cy],
              ["L", cx - 2.5, cy + 2.5],
            ),
            stroke: WHITE,
            "stroke-width": "1",
            fill: "none",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
          },
        ],
      ],
    ];
  }),

  parts: onObject(({ x, y, w, h }) => [
    [
      "rect",
      { class: "tdm-hide", x: x - 1, y: y - 1, width: w + 2, height: h + 2, fill: "#141518" },
    ],
    rimmed("tdm-ghost", { x, y, w, h }, {
      rx: "1",
      fill: "none",
      stroke: WHITE,
      "stroke-width": "0.8",
      "stroke-dasharray": "2 1.6",
    }),
  ]),

  select: onObject(({ x, y, w, h }) => {
    const [cx, cy] = [midOf(x, w), midOf(y, h)];
    return [
      [
        "g",
        { class: "tdm-picked" },
        rimmed(undefined, { x, y, w, h }, {
          rx: "1",
          fill: WHITE,
          "fill-opacity": "0.1",
          stroke: WHITE,
          "stroke-width": "1",
        }),
      ],
      click(cx, cy),
      [
        "path",
        {
          class: "tdm-pointer",
          d: "M0 0L0 8.5L2.3 6.4L3.9 10L5.4 9.3L3.8 5.9L6.9 5.6Z",
          fill: WHITE,
          stroke: "#0c0f12",
          "stroke-width": "0.8",
          "stroke-linejoin": "round",
          style: { "--to-x": `${cx}px`, "--to-y": `${cy}px` },
        },
      ],
    ];
  }),

  size: onObject(({ x, y, w, h }) => {
    const [cx, cy] = [midOf(x, w), midOf(y, h)];
    const corners =
      trace(["M", x - 4, y - 4]) +
      "l3 0m-3 0l0 3" +
      trace(["M", x + w + 4, y + h + 4]) +
      "l-3 0m3 0l0 -3";
    return [
      [
        "g",
        { class: "tdm-grow", style: { "--cx": `${cx}px`, "--cy": `${cy}px` } },
        rimmed(undefined, { x, y, w, h }, {
          rx: "1",
          fill: "none",
          stroke: WHITE,
          "stroke-width": "0.8",
        }),
        ["path", { d: corners, stroke: WHITE, "stroke-width": "0.9", "stroke-linecap": "round" }],
      ],
    ];
  }),

  model: onObject(({ x, y, w, h }) => {
    const [cx, cy] = [midOf(x, w), midOf(y, h)];
    const s = Math.min(w, h, 18) / 2;
    const axis = (tail, stroke) => [
      "path",
      { d: trace(["M", cx, cy + s * 0.2], tail), stroke, "stroke-width": "1" },
    ];
    return [
      [
        "path",
        {
          class: "tdm-build",
          d: trace(
            ["M", cx - s, cy - s * 0.4],
            ["L", cx, cy - s],
            ["L", cx + s, cy - s * 0.4],
            ["V", cy + s * 0.6],
            ["L", cx, cy + s * 1.2],
            ["L", cx - s, cy + s * 0.6],
            ["Z"],
            ["M", cx - s, cy - s * 0.4],
            ["L", cx, cy + s * 0.2],
            ["L", cx + s, cy - s * 0.4],
            ["M", cx, cy + s * 0.2],
            ["V", cy + s * 1.2],
          ),
          pathLength: "1",
          fill: TEAL,
          "fill-opacity": "0.18",
          stroke: WHITE,
          "stroke-width": "0.9",
          "stroke-linejoin": "round",
        },
      ],
      [
        "g",
        { class: "tdm-gizmo", stroke: "none" },
        axis(["H", cx + s * 1.8], "#d97b75"),
        axis(["V", cy - s * 1.6], "#73a68e"),
        axis(["L", cx - s * 1.2, cy + s * 1.3], "#7f9cf0"),
      ],
    ];
  }),
};

const FRAME_ACTIONS = {
  marquee: onFrame(({ x, y, w, h }) => [
    [
      "g",
      { class: "tdm-marquee", style: { "--ox": `${x}px`, "--oy": `${y}px` } },
      [
        "rect",
        {
          x,
          y,
          width: w,
          height: h,
          fill: WHITE,
          "fill-opacity": "0.06",
          stroke: WHITE,
          "stroke-width": "0.8",
          "stroke-dasharray": "2.4 2",
          class: "tdm-ants",
        },
      ],
    ],
  ]),

  shape: onFrame(({ x, y, w, h }) => [
    [
      "g",
      { class: "tdm-shape", style: { "--ox": `${x}px`, "--oy": `${y}px` } },
      [
        "rect",
        {
          x,
          y,
          width: w,
          height: h,
          rx: "1.5",
          fill: TEAL,
          "fill-opacity": "0.25",
          stroke: TEAL,
          "stroke-width": "1.2",
        },
      ],
    ],
  ]),

  picture: onFrame(({ x, y, w, h }, id) => {
    // Углы рамки: левый верхний, правый верхний, левый нижний, правый нижний.
    const edge = (from, size, far) => (far ? from + size + 1.5 : from - 1.5);
    const corners = [0, 1].flatMap((low) =>
      [0, 1].map((right) => [edge(x, w, right), edge(y, h, low)]),
    );
    const knobs = corners.map(([cx, cy]) => [
      "rect",
      {
        key: `${cx}/${cy}`,
        x: cx - 1.6,
        y: cy - 1.6,
        width: "3.2",
        height: "3.2",
        rx: "0.6",
        fill: WHITE,
        stroke: "#0c0f12",
        "stroke-width": "0.5",
      },
    ]);
    return [
      [
        "g",
        { class: "tdm-drop" },
        diagonal(`pic-${id}`, [
          ["0", "#ffd36e"],
          ["1", "#ff6a3d"],
        ]),
        ["rect", { x, y, width: w, height: h, rx: "0.8", fill: `url(#pic-${id})` }],
        [
          "path",
          {
            d: STAR,
            transform: `translate(${midOf(x, w)} ${midOf(y, h)}) scale(${Math.min(w, h) / 16})`,
            fill: WHITE,
          },
        ],
        [
          "g",
          { class: "tdm-handles" },
          rimmed(undefined, { x, y, w, h }, {
            rx: "1",
            fill: "none",
            stroke: WHITE,
            "stroke-width": "0.7",
          }),
          knobs,
        ],
      ],
    ];
  }),
};

const SPOT_ACTIONS = {
  picker: onSpot(({ x, y }) => [
    ["circle", { cx: x, cy: y, r: "4.2", fill: "#e0864a" }],
    [
      "circle",
      {
        class: "tdm-sample",
        cx: x,
        cy: y,
        r: "4.2",
        fill: "none",
        stroke: WHITE,
        "stroke-width": "0.8",
      },
    ],
    [
      "g",
      { class: "tdm-dropper", style: { "--to-x": `${x}px`, "--to-y": `${y}px` } },
      [
        "g",
        { transform: "rotate(38) scale(1.5)" },
        [
          "path",
          {
            d: "M-0.45 0H0.45L1.35 -4.2V-11H-1.35V-4.2Z",
            fill: WHITE,
            "fill-opacity": "0.2",
            stroke: WHITE,
            "stroke-width": "0.5",
            "stroke-linejoin": "round",
          },
        ],
        [
          "path",
          { class: "tdm-draw-up", d: "M-0.28 -0.5H0.28L0.9 -4.2V-9H-0.9V-4.2Z", fill: "#e0864a" },
        ],
        [
          "rect",
          { x: "-2.3", y: "-12.6", width: "4.6", height: "1.7", rx: "0.5", fill: "#c9ccd1" },
        ],
        slab("M-1.9 -12.6V-16.1A1.9 1.9 0 0 1 1.9 -16.1V-12.6Z", "#e8eaed"),
      ],
    ],
    [
      "g",
      { transform: "translate(140 52)" },
      [
        "rect",
        {
          x: "-1",
          y: "-1",
          width: "14",
          height: "10",
          rx: "2.4",
          fill: "#0c0d10",
          "fill-opacity": "0.85",
        },
      ],
      ["rect", { x: "1", y: "1", width: "10", height: "6", rx: "1.4", fill: "#3b3f46" }],
      [
        "rect",
        {
          class: "tdm-swatch",
          x: "1",
          y: "1",
          width: "10",
          height: "6",
          rx: "1.4",
          fill: "#e0864a",
        },
      ],
    ],
  ]),

  emblem: onSpot(({ x, y }) => [
    click(x, y),
    [
      "g",
      { class: "tdm-pop", style: { "--x": `${x}px`, "--y": `${y}px` } },
      ["circle", { r: "6.5", fill: TEAL, stroke: WHITE, "stroke-width": "0.8" }],
      ["path", { d: STAR, transform: "scale(0.6)", fill: WHITE }],
    ],
  ]),

  text: onSpot(({ x, y }, id, anchors) => {
    const word = anchors.word || {};
    const { size, half } = inkBox(word);
    return [
      [
        "defs",
        {},
        [
          "clipPath",
          { id: `type-${id}` },
          [
            "rect",
            {
              class: "tdm-type",
              x: x - half,
              y: y - size * 0.75,
              width: half * 2,
              height: size * 1.5,
            },
          ],
        ],
      ],
      click(x, y),
      [
        "text",
        {
          "data-audit-ignore": AUDIT_SKIP,
          x,
          y,
          "clip-path": `url(#type-${id})`,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          fill: WHITE,
          stroke: word.plain ? "none" : "#0c0f12",
          "stroke-width": size / 8,
          "paint-order": "stroke",
          class: "tdm-word",
          "font-size": size,
          ...(word.plain && { "font-weight": "800" }),
          ...(word.width && { textLength: word.width, lengthAdjust: "spacingAndGlyphs" }),
        },
        "ASTRAL",
      ],
    ];
  }),

  effect: onSpot(({ x, y }) => [
    [
      "path",
      {
        class: "tdm-tracer",
        d: `M4 ${y + 6}L${x} ${y}`,
        pathLength: "1",
        stroke: TEAL,
        "stroke-width": "1.4",
        "stroke-linecap": "round",
      },
    ],
    ...SPARK_ANGLES.map((angle, i) => sparkle(angle, i, x, y)),
  ]),

  tune: onSpot(({ x, y }) => [
    [
      "g",
      { class: "tdm-tune", style: { "--x": `${x}px`, "--y": `${y}px` } },
      [
        "circle",
        {
          class: "tdm-ring",
          cx: x,
          cy: y,
          r: "8",
          fill: "none",
          stroke: TEAL,
          "stroke-width": "0.9",
        },
      ],
      [
        "g",
        { class: "tdm-arms", stroke: TEAL, "stroke-width": "1.3", "stroke-linecap": "round" },
        ...ARMS.map(([cls, dx, dy]) => ["path", { class: cls, d: armPath(dx, dy, x, y) }]),
      ],
    ],
  ]),
};

const PAINT_ACTIONS = {
  paint: planned(({ id, anchors, toolId, target }) => {
    const key = paintKey(target, toolId);
    return [
      clipDefs("paint", id, key, anchors),
      [
        "g",
        { "clip-path": `url(#paint-${id})` },
        [
          "rect",
          {
            class: SOLID_TARGETS.includes(key) ? "tdm-sweep is-solid" : "tdm-sweep",
            width: DEMO_W,
            height: DEMO_H,
          },
        ],
        [
          "rect",
          {
            class: "tdm-edge",
            x: "-1",
            width: "2",
            height: DEMO_H,
            fill: WHITE,
            "fill-opacity": "0.85",
          },
        ],
      ],
    ];
  }),

  pattern: planned(({ id, anchors, toolId, target }) => {
    const key = paintKey(target, toolId);
    const { x, y } = anchors.spot;
    const stripes = [
      "pattern",
      {
        id: `stripes-${id}`,
        width: "6",
        height: "6",
        patternUnits: "userSpaceOnUse",
        patternTransform: "rotate(35)",
      },
      ["rect", { width: "3", height: "6", fill: TEAL }],
    ];
    return [
      clipDefs("pattern", id, key, anchors, stripes),
      [
        "g",
        { "clip-path": `url(#pattern-${id})` },
        [
          "rect",
          { class: "tdm-stamp", width: DEMO_W, height: DEMO_H, fill: `url(#stripes-${id})` },
        ],
      ],
      click(x, y),
    ];
  }),

  standard: planned(({ id, anchors, toolId, target }) => [
    clipDefs("std", id, paintKey(target, toolId), anchors),
    [
      "rect",
      { class: "tdm-unpaint", width: DEMO_W, height: DEMO_H, "clip-path": `url(#std-${id})` },
    ],
    [
      "g",
      { transform: "translate(148 11)" },
      ["circle", { r: "7", fill: "#0c0d10", "fill-opacity": "0.85" }],
      [
        "path",
        {
          class: "tdm-reset",
          d: "M-3.2 -1.2A3.6 3.6 0 1 1 -2.4 2.8M-3.2 -1.2V-3.8M-3.2 -1.2H-0.6",
          stroke: WHITE,
          "stroke-width": "1",
          fill: "none",
          "stroke-linecap": "round",
        },
      ],
    ],
  ]),

  zone: planned(({ anchors }) => {
    const area = anchors.zone || anchors.body;
    return [
      [
        "path",
        {
          class: "tdm-zone",
          d: area,
          fill: TEAL,
          stroke: TEAL,
          "stroke-width": "1.2",
          "stroke-linejoin": "round",
        },
      ],
      [
        "path",
        {
          class: "tdm-border",
          d: area,
          fill: "none",
          stroke: WHITE,
          "stroke-width": "0.8",
          "stroke-dasharray": "3 2.4",
          "stroke-linejoin": "round",
        },
      ],
    ];
  }),
};

const FREE_ACTIONS = {
  light: planned(({ anchors }) => {
    const given = anchors.lights || [];
    const spots = given.length ? given : [[anchors.spot.x, anchors.spot.y]];
    return [
      spots.map(([x, y], i) => [
        "g",
        { key: `${x},${y}`, class: "tdm-glow", style: { "--i": i } },
        glowRing(x, y, "13", TEAL, "0.16"),
        glowRing(x, y, "6", TEAL, "0.32"),
        glowRing(x, y, "2.4", WHITE),
      ]),
    ];
  }),

  templates: planned(() => [
    ...TINTS.map((tint, i) => [
      "rect",
      { class: "tdm-tint", width: DEMO_W, height: DEMO_H, fill: tint, style: { "--i": i } },
    ]),
    [
      "g",
      { transform: "translate(124 52)" },
      [
        "rect",
        {
          x: "-2",
          y: "-2",
          width: "34",
          height: "11",
          rx: "3",
          fill: "#0c0d10",
          "fill-opacity": "0.8",
        },
      ],
      ...TINTS.map((tint, i) => [
        "g",
        { transform: `translate(${i * 11} 0)` },
        ["rect", { width: "8", height: "7", rx: "1.6", fill: tint }],
        [
          "rect",
          {
            class: "tdm-chip",
            x: "-1",
            y: "-1",
            width: "10",
            height: "9",
            rx: "2.2",
            fill: "none",
            stroke: WHITE,
            "stroke-width": "0.8",
            style: { "--i": i },
          },
        ],
      ]),
    ],
  ]),

  draw: planned(({ anchors }) => [
    [
      "path",
      {
        class: "tdm-stroke",
        pathLength: "1",
        d: anchors.route || FALLBACK_ROUTE,
        fill: "none",
        stroke: TEAL,
        "stroke-width": anchors.route ? 1.8 : 3,
        "stroke-linecap": "round",
      },
    ],
  ]),

  eraser: planned(({ id, anchors }) => {
    const route = anchors.route || FALLBACK_ROUTE;
    const [x0, y0] = pairAt(route, /^M([\d.]+) ([\d.]+)/);
    const [x1, y1] = pairAt(route, /([\d.]+) ([\d.]+)$/);
    return [
      [
        "defs",
        {},
        [
          "clipPath",
          { id: `erase-${id}` },
          [
            "rect",
            {
              class: "tdm-left",
              x: x0 - 4,
              width: x1 - x0 + 8,
              height: DEMO_H,
              style: { "--right": `${x1 + 4}px` },
            },
          ],
        ],
      ],
      [
        "path",
        {
          d: route,
          fill: "none",
          stroke: TEAL,
          "stroke-width": anchors.route ? 1.8 : 3,
          "stroke-linecap": "round",
          "clip-path": `url(#erase-${id})`,
        },
      ],
      [
        "circle",
        {
          class: "tdm-eraser",
          r: "6",
          fill: WHITE,
          "fill-opacity": "0.16",
          stroke: WHITE,
          "stroke-width": "0.8",
          style: {
            "--ex0": `${x0}px`,
            "--ey0": `${y0}px`,
            "--ex1": `${x1}px`,
            "--ey1": `${y1}px`,
          },
        },
      ],
    ];
  }),

  sound: planned(() => [
    [
      "g",
      { transform: "translate(146 12)" },
      slab("M-4 -2H-2L1 -4.5V4.5L-2 2H-4Z", WHITE),
      [
        "path",
        {
          class: "tdm-waves",
          d: "M3 -2.5A3.5 3.5 0 0 1 3 2.5M5 -4.5A6 6 0 0 1 5 4.5",
          stroke: WHITE,
          "stroke-width": "0.9",
          fill: "none",
          "stroke-linecap": "round",
        },
      ],
    ],
  ]),
};

const ACTIONS = {
  ...FREE_ACTIONS,
  ...PAINT_ACTIONS,
  ...SPOT_ACTIONS,
  ...FRAME_ACTIONS,
  ...OBJECT_ACTIONS,
};

// ---------------------------------------------------------------------------
// Якоря и рисунки земель.
// ---------------------------------------------------------------------------

const HALL = {
  body: "M0 0L36 10V42L0 64ZM160 0L124 10V42L160 64ZM36 10H124V42H36Z",
  box: "M102 45L106 42H126L122 45ZM102 45H122V57H102ZM122 45L126 42V54L122 57Z",
  ceiling: "M0 0H160L124 10H36Z",
  floor: "M36 42H124L160 64H0Z",
  frame: box(64, 16, 32, 16),
  lights: [50, 80, 110].map((lampX) => [lampX, 5]),
  object: box(102, 42, 24, 15),
  sign: "M41 13.5H50V17.5H41Z",
  spot: dot(80, 24),
};

const hallArt = planned(() => [
  slab("M0 0H160L124 10H36Z", "#111215"),
  slab("M0 0L36 10V42L0 64Z", "#26282d"),
  slab("M160 0L124 10V42L160 64Z", "#26282d"),
  slab("M36 10H124V42H36Z", "#2f3137"),
  slab("M36 42H124L160 64H0Z", "#1b1c20"),
  [
    "path",
    {
      d: "M36 42L0 64M58 42L40 64M80 42V64M102 42L120 64M124 42L160 64M27 47.5H133M13 56H147",
      stroke: WHITE,
      "stroke-opacity": "0.06",
      "stroke-width": "0.7",
      fill: "none",
    },
  ],
  [
    "rect",
    {
      x: "64",
      y: "16",
      width: "32",
      height: "16",
      rx: "1.5",
      fill: "#0d0e10",
      stroke: "#40434b",
      "stroke-width": "0.8",
    },
  ],
  ...[50, 80, 110].map((cx) => [
    "ellipse",
    { cx, cy: "5", rx: "4", ry: "1.4", fill: "#f1e2c2", "fill-opacity": "0.7" },
  ]),
  slab("M102 45L106 42H126L122 45Z", "#41444c"),
  slab("M102 45H122V57H102Z", "#2c2e34"),
  slab("M122 45L126 42V54L122 57Z", "#232529"),
  slab("M41 13.5H50V17.5H41Z", "#2f8f5a"),
]);

const FACADE = {
  body: "M28 14H132V52H28Z",
  box: "M134 40H154V43H134ZM136 43H152V52H136Z",
  frame: box(50, 28, 60, 18),
  ground: "M0 52H160V64H0Z",
  lights: [44, 116].map((lampX) => [lampX, 33]),
  object: box(136, 40, 18, 12),
  spot: dot(80, 22.5),
};

const FACADE_VARIANTS = {
  board: {
    over: {
      craft: "M50 16H110V40H50Z",
      frame: box(53, 19, 54, 18),
      spot: dot(80, 28),
      object: box(50, 16, 60, 24),
    },
    draw: (craft) => [
      ["path", { d: craft, fill: "#101215", stroke: "#40434b", "stroke-width": "0.8" }],
      [
        "path",
        {
          d: "M55 22H82M55 27H96M55 32H88M55 36H76",
          stroke: "#d9b06a",
          "stroke-opacity": "0.7",
          "stroke-width": "1.4",
          "stroke-linecap": "round",
        },
      ],
    ],
  },
  mark: {
    over: {
      craft: "M74.5 33A5.5 5.5 0 1 0 85.5 33A5.5 5.5 0 1 0 74.5 33Z",
      frame: box(75, 28, 10, 10),
      spot: dot(80, 33),
      object: box(73.5, 26.5, 13, 13),
    },
    draw: (craft) => [
      slab(craft, "#e8eaed"),
      [
        "path",
        {
          d: "M80 36.5V30M77.4 32.4L80 29.8L82.6 32.4",
          stroke: "#0c0d10",
          "stroke-width": "1.2",
          fill: "none",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
      ],
    ],
  },
};

// 2 ряда по 8 окон: горит окно, если (ряд + колонка) делится на 3.
const facadeWindows = () => {
  const columnLefts = [33, 45.4, 57.8, 70.2, 82.6, 95, 107.4, 119.8];
  const rowTops = [30, 40];
  return rowTops.flatMap((top, row) =>
    columnLefts.map((left, col) => {
      const glowing = (row + col) % 3 === 0;
      return [
        "rect",
        {
          x: left,
          y: top,
          width: "8",
          height: "5",
          rx: "0.6",
          fill: glowing ? "#d9b06a" : "#3c414a",
          "fill-opacity": glowing ? "0.55" : "1",
        },
      ];
    }),
  );
};

const facadeArt = planned(({ id, variant }) => {
  const extra = variantOf(FACADE_VARIANTS, variant);
  return [
    vertical(`fsky-${id}`, [
      ["0", "#1a2330"],
      ["1", "#0e1217"],
    ]),
    wash(`url(#fsky-${id})`),
    slab(FACADE.body, "#2d3036"),
    slab("M26 12H134V15H26Z", "#3b3f46"),
    ...facadeWindows(),
    [
      "rect",
      {
        x: "46",
        y: "19",
        width: "68",
        height: "7",
        rx: "1",
        fill: "#15171a",
        stroke: "#40434b",
        "stroke-width": "0.6",
      },
    ],
    slab("M72 38H88V52H72Z", "#121316"),
    ["path", { d: "M80 38V52", stroke: "#3c414a", "stroke-width": "0.6" }],
    ["rect", { y: "52", width: "160", height: "12", fill: "#17181b" }],
    ["path", { d: "M0 52.4H160", stroke: "#2c2e33", "stroke-width": "0.8" }],
    slab("M134 40H154V43H134Z", "#41444c"),
    slab("M136 43H152V52H136Z", "#30333a"),
    ...(extra ? extra.draw(extra.over.craft) : []),
  ];
});

const STREET = {
  body: "M66 30H94L160 56V64H0V56Z",
  box:
    "M104 32H124V34H104ZM104.4 34H105.6V42H104.4ZM122.4 34H123.6V42H122.4ZM106.5 35H121.5V40H106.5Z",
  frame: box(14, 7, 34, 15),
  lights: [[124, 21]],
  lines: "M78.6 32H81.4V64H78.6Z",
  object: box(104, 32, 20, 10),
  side: "M0 44L60 30H66L0 56ZM160 44L100 30H94L160 56Z",
  spot: dot(80, 48),
};

const STREET_SHELTER = [
  slab("M104 32H124V34H104Z", "#41444c"),
  ["path", { d: "M105 34V42M123 34V42", stroke: "#4a4e55", "stroke-width": "0.9" }],
  [
    "rect",
    { x: "106.5", y: "35", width: "15", height: "5", fill: "#9fb4c8", "fill-opacity": "0.12" },
  ],
];

const STREET_VARIANTS = {
  atm: {
    over: {
      craft: "M106 29H117V47H106Z",
      frame: box(107.5, 31, 8, 6),
      spot: dot(111.5, 34),
      object: box(106, 29, 11, 18),
    },
    draw: (craft) => [
      slab(craft, "#3d4148"),
      [
        "rect",
        {
          x: "107.5",
          y: "31",
          width: "8",
          height: "6",
          rx: "0.6",
          fill: "#7fa7c9",
          "fill-opacity": "0.5",
        },
      ],
      ["rect", { x: "108", y: "39", width: "7", height: "3", rx: "0.5", fill: "#26282d" }],
    ],
  },
  smoke: {
    over: {
      craft:
        "M28 50A6 6 0 1 0 40 50A6 6 0 1 0 28 50ZM36 45.5A7.5 7.5 0 1 0 51 45.5A7.5 7.5 0 1 0 36 45.5ZM46 50A6 6 0 1 0 58 50A6 6 0 1 0 46 50Z",
      frame: box(30, 41, 26, 12),
      spot: dot(61, 51),
      object: box(28, 38, 30, 18),
    },
    draw: (craft) => [
      ...STREET_SHELTER,
      ["path", { d: craft, fill: "#c9ccd1", "fill-opacity": "0.7" }],
      slab("M60 46L67 41H89L97 46H101V53H60Z", "#3b3f46"),
      ["path", { d: "M68 42H88L94 46H66Z", fill: "#9fb4c8", "fill-opacity": "0.18" }],
      ["circle", { cx: "68", cy: "53", r: "3.4", fill: "#0c0d10" }],
      ["circle", { cx: "92", cy: "53", r: "3.4", fill: "#0c0d10" }],
    ],
  },
};

const streetArt = planned(({ id, variant }) => {
  const extra = variantOf(STREET_VARIANTS, variant);
  return [
    vertical(`ssky-${id}`, [
      ["0", "#111923"],
      ["1", "#1d2733"],
    ]),
    ["rect", { width: "160", height: "32", fill: `url(#ssky-${id})` }],
    slab(
      "M0 30V20H10V14H20V22H34V10H44V18H58V24H70V16H84V22H96V12H108V20H120V26H136V18H148V22H160V30Z",
      "#0f1318",
    ),
    ["rect", { y: "30", width: "160", height: "34", fill: "#1a1c1f" }],
    slab(STREET.side, "#33363b"),
    slab(STREET.body, "#24262a"),
    [
      "path",
      {
        d: "M66 30L0 56M94 30L160 56",
        stroke: WHITE,
        "stroke-opacity": "0.35",
        "stroke-width": "0.8",
      },
    ],
    [
      "path",
      { d: "M80 32V64", stroke: "#d9b24c", "stroke-width": "1.4", "stroke-dasharray": "3.2 3.2" },
    ],
    ["path", { d: "M30 22V40", stroke: "#4a4e55", "stroke-width": "1.2" }],
    [
      "rect",
      {
        x: "14",
        y: "7",
        width: "34",
        height: "15",
        rx: "1",
        fill: "#0d0e10",
        stroke: "#40434b",
        "stroke-width": "0.7",
      },
    ],
    [
      "path",
      { d: "M132 18V46M132 19H125", stroke: "#4a4e55", "stroke-width": "1.2", fill: "none" },
    ],
    ["path", { d: "M124 22L113 47H135Z", fill: "#f2d79a", "fill-opacity": "0.07" }],
    ["ellipse", { cx: "124", cy: "21", rx: "2.6", ry: "1.2", fill: "#f2d79a" }],
    ...(extra ? extra.draw(extra.over.craft) : STREET_SHELTER),
  ];
});

// Небо: у каждого предмета свои якоря и своя отделка. Вид ищется как ключ
// таблицы; незнакомый вид и пустая строка дают дирижабль.
const SKY_KINDS = {
  blimp: {
    craft: "M60 26A20 6 0 1 0 100 26A20 6 0 1 0 60 26ZM98 26L104 21V31ZM76 31.5H84V34.1H76Z",
    word: { size: 6.5, width: 26 },
    frame: box(67, 23.5, 26, 5),
    spot: dot(80, 26),
    object: box(58, 18, 48, 17),
  },
  dragon: {
    craft:
      "M80 20C83 20 85 22 86 25L104 14L98 26L108 25L90 31C88 34 84 36 80 36C76 36 72 34 70 31L52 25L62 26L56 14L74 25C75 22 77 20 80 20ZM78 35L76 44L80 40L84 44L82 35Z",
    frame: box(72, 25, 16, 6),
    spot: dot(80, 28),
    object: box(52, 14, 56, 30),
  },
  phoenix: {
    craft:
      "M80 20C83 20 85 22 86 25L104 14L98 26L108 25L90 31C88 34 84 36 80 36C76 36 72 34 70 31L52 25L62 26L56 14L74 25C75 22 77 20 80 20ZM78 35L74 46L80 41L86 46L82 35Z",
    frame: box(72, 25, 16, 6),
    spot: dot(80, 28),
    object: box(52, 14, 56, 32),
  },
  griffin: {
    craft:
      "M80 21C84 21 86 23 87 26L105 15L99 27L108 27L90 32C87 35 84 36 80 36C76 36 73 35 70 32L52 27L61 27L55 15L73 26C74 23 76 21 80 21ZM77 35L75 42H79ZM83 35L85 42H81Z",
    frame: box(72, 26, 16, 6),
    spot: dot(80, 29),
    object: box(52, 15, 56, 27),
  },
  eastern_dragon: {
    craft:
      "M52 30C58 22 64 22 70 28C76 34 82 34 88 26C94 18 100 18 106 24L111 22L108 29C102 24 98 24 93 30C86 38 78 38 71 32C65 27 62 27 56 34Z",
    frame: box(66, 27, 28, 6),
    spot: dot(80, 31),
    object: box(52, 18, 59, 20),
  },
  balloon: {
    craft:
      "M80 8C91 8 97 15 97 24C97 32 90 37 85 41H75C70 37 63 32 63 24C63 15 69 8 80 8ZM76.5 44H83.5V49H76.5Z",
    frame: box(68, 21, 24, 6),
    spot: dot(80, 24),
    object: box(63, 8, 34, 41),
  },
  lantern: {
    craft: "M72 14H82L80 28H74ZM90 22H98L96.5 33H91.5ZM60 26H66L65 34H61Z",
    frame: box(73, 18, 8, 6),
    spot: dot(77, 21),
    object: box(60, 14, 38, 20),
  },
  ufo: {
    craft: "M58 28A22 5 0 1 0 102 28A22 5 0 1 0 58 28ZM70 27C70 20 74 16 80 16C86 16 90 20 90 27Z",
    frame: box(70, 25, 20, 5),
    spot: dot(80, 26),
    object: box(58, 16, 44, 17),
  },
  whale: {
    craft:
      "M56 27C56 20 67 17 80 18C91 19 97 22 100 26L110 19L108 27L111 34L100 29C96 34 86 36 76 35C65 34 56 32 56 27Z",
    frame: box(66, 23, 24, 6),
    spot: dot(78, 26),
    object: box(56, 17, 55, 19),
  },
  jellyfish: {
    craft: "M66 26C66 15 72 10 80 10C88 10 94 15 94 26C90 28 70 28 66 26Z",
    frame: box(70, 17, 20, 5),
    spot: dot(80, 19),
    object: box(66, 10, 28, 30),
  },
  banner: {
    craft:
      "M40 24L50 23L53 20H56L55 23L60 23.5V26.5L55 27L56 30H53L50 27L40 26ZM66 20H112V31H66Z",
    frame: box(68, 22, 42, 7),
    spot: dot(89, 25.5),
    object: box(40, 20, 72, 11),
  },
  flag: {
    craft: "M62 14C70 11 78 17 86 14C94 11 100 14 102 15V33C94 30 88 35 80 33C72 31 68 30 62 33Z",
    frame: box(66, 17, 32, 13),
    spot: dot(82, 24),
    object: box(62, 14, 40, 19),
  },
  logo: {
    craft: "M64 10H96Q100 10 100 14V34Q100 38 96 38H64Q60 38 60 34V14Q60 10 64 10Z",
    frame: box(64, 14, 32, 20),
    spot: dot(80, 24),
    object: box(60, 10, 40, 28),
  },
  letters: {
    craft: "M0 0H160V50H0Z",
    glyphs: { size: 12.5, text: "VINEWOOD", width: 76, x: 78.5, y: 33 },
    word: { plain: true, size: 12.5, width: 60 },
    frame: box(40, 26, 77, 14),
    spot: dot(78.5, 33),
    object: box(40, 26, 77, 14),
  },
  clear: {
    craft: "M0 0H160V50H0Z",
    frame: box(30, 12, 34, 8),
    spot: dot(80, 24),
    object: box(22, 10, 40, 12),
  },
};

const skyKind = (variant) => (Object.hasOwn(SKY_KINDS, variant) ? variant : "blimp");

const skyAnchors = (variant) => {
  const { craft, frame, glyphs, object, spot, word } = SKY_KINDS[skyKind(variant)];
  return {
    body: "M0 0H160V50H0Z",
    clouds:
      "M19 16A17 3.6 0 1 0 53 16A17 3.6 0 1 0 19 16ZM52 9A10 2.4 0 1 0 72 9A10 2.4 0 1 0 52 9Z",
    craft,
    frame,
    glyphs,
    lights: [[128, 40]],
    object,
    spot,
    word,
  };
};

const SKY_FILLS = {
  blimp: "#c7ccd4",
  dragon: "#9a4040",
  phoenix: "#e28a3c",
  griffin: "#b5925e",
  eastern_dragon: "#3f8a5a",
  balloon: "#c75b4a",
  lantern: "#e59a4c",
  ufo: "#aab3bf",
  whale: "#4c6e9a",
  jellyfish: "#b77ad6",
  banner: "#d4d7dc",
  flag: "#c7ccd4",
  logo: "#c7ccd4",
};

const SKY_GLOWS = { phoenix: "#f2b45a", lantern: "#f2b45a", jellyfish: "#c9a0ff", logo: WHITE };

const SKY_TRIM = {
  blimp: [
    [
      "path",
      {
        d: "M60 26C64 22 70 20.6 80 20.6",
        stroke: WHITE,
        "stroke-opacity": "0.4",
        "stroke-width": "0.8",
        fill: "none",
      },
    ],
  ],
  dragon: [["circle", { cx: "80", cy: "22.5", r: "0.9", fill: "#ffcf6a" }]],
  balloon: [
    [
      "path",
      {
        d: "M80 8C76 14 75 30 77 41M80 8C84 14 85 30 83 41M75 41L76.5 44M85 41L83.5 44",
        stroke: "#000000",
        "stroke-opacity": "0.25",
        "stroke-width": "0.7",
        fill: "none",
      },
    ],
  ],
  ufo: [["path", { d: "M70 33L60 50H100L90 33Z", fill: "#bfe6ff", "fill-opacity": "0.12" }]],
  whale: [["circle", { cx: "63", cy: "25", r: "0.9", fill: "#0b1018" }]],
  jellyfish: [
    [
      "path",
      {
        d: "M70 27C68 32 72 35 70 40M76 28C75 33 78 36 76 42M84 28C85 33 82 36 84 42M90 27C92 32 88 35 90 40",
        stroke: "#c9a0ff",
        "stroke-opacity": "0.7",
        "stroke-width": "0.8",
        fill: "none",
      },
    ],
  ],
  banner: [
    ["path", { d: "M60 25H66", stroke: WHITE, "stroke-opacity": "0.6", "stroke-width": "0.5" }],
  ],
  flag: [["path", { d: "M61.3 12V52", stroke: "#8e949e", "stroke-width": "1.2" }]],
  logo: [
    [
      "path",
      {
        d: STAR,
        transform: "translate(80 24) scale(1.2)",
        fill: "#0c0d10",
        "fill-opacity": "0.35",
      },
    ],
  ],
};

const SKYLINE =
  "M0 64V54H8V50H18V56H30V48H40V54H52V51H64V56H80V49H92V55H106V52H118V57H134V50H146V55H160V64Z";

const skyForeground = (name, k, kind) => {
  if (k.glyphs) {
    const cls = LETTER_TOOLS.includes(kind) ? "tdm-word tdm-replaced" : "tdm-word";
    return [
      slab("M0 64V46C30 34 60 30 90 33C120 36 140 42 160 46V64Z", "#26301f"),
      glyphText(k.glyphs, cls, "#e6e8eb"),
    ];
  }
  const glow = SKY_GLOWS[name];
  return [
    ...(glow
      ? [
          [
            "ellipse",
            {
              cx: k.spot.x,
              cy: k.spot.y,
              rx: k.object.w * 0.6,
              ry: k.object.h * 0.6,
              fill: glow,
              "fill-opacity": "0.12",
            },
          ],
        ]
      : []),
    ...(SKY_FILLS[name] ? [slab(k.craft, SKY_FILLS[name])] : []),
    ...(SKY_TRIM[name] || []),
    slab(SKYLINE, "#0b1018"),
  ];
};

const skyArt = planned(({ id, variant, kind }) => {
  const name = skyKind(variant);
  return [
    vertical(`sky-${id}`, [
      ["0", "#0d1f38"],
      ["0.68", "#24496f"],
      ["1", "#8d5a3e"],
    ]),
    wash(`url(#sky-${id})`),
    ["circle", { cx: "128", cy: "40", r: "14", fill: "#f2c27a", "fill-opacity": "0.1" }],
    ["circle", { cx: "128", cy: "40", r: "6.5", fill: "#f2c27a", "fill-opacity": "0.85" }],
    ["ellipse", { cx: "36", cy: "16", rx: "17", ry: "3.6", fill: WHITE, "fill-opacity": "0.1" }],
    ["ellipse", { cx: "62", cy: "9", rx: "10", ry: "2.4", fill: WHITE, "fill-opacity": "0.08" }],
    ...skyForeground(name, SKY_KINDS[name], kind),
  ];
});

const HUD_PANEL_D = "M8 34H42V58H8Z";

const HUD = {
  bars: "M8 59.6H30V61.1H8ZM31 59.6H42V61.1H31Z",
  body: HUD_PANEL_D,
  cross:
    "M78.8 24H81.2V30H78.8ZM78.8 34H81.2V40H78.8ZM72 30.8H78V33.2H72ZM82 30.8H88V33.2H82ZM78.6 32A1.4 1.4 0 1 0 81.4 32A1.4 1.4 0 1 0 78.6 32Z",
  frame: box(8, 34, 34, 24),
  lights: [],
  map: HUD_PANEL_D,
  object: box(70, 22, 20, 20),
  route: "M12 52C18 46 24 50 30 42C33 38 36 38 40 37",
  screen: "M0 0H160V64H0Z",
  spot: dot(80, 32),
};

const hudArt = planned(({ id }) => [
  diagonal(`hud-${id}`, [
    ["0", "#202631"],
    ["1", "#0f1216"],
  ]),
  wash(`url(#hud-${id})`),
  ["path", { d: "M50 64L96 18H112L82 64Z", fill: WHITE, "fill-opacity": "0.035" }],
  ["path", { d: "M118 30H126V18H136V26H146V12H156V34H118Z", fill: WHITE, "fill-opacity": "0.04" }],
  [
    "rect",
    {
      x: "8",
      y: "34",
      width: "34",
      height: "24",
      rx: "3",
      fill: "#0b0e11",
      stroke: WHITE,
      "stroke-opacity": "0.28",
      "stroke-width": "0.7",
    },
  ],
  [
    "path",
    {
      d: "M12 52C18 46 24 50 30 42C33 38 36 38 40 37M20 34V58",
      stroke: WHITE,
      "stroke-opacity": "0.28",
      "stroke-width": "0.8",
      fill: "none",
    },
  ],
  slab("M25 44L27.5 49H22.5Z", WHITE),
  ["rect", { x: "8", y: "59.6", width: "22", height: "1.5", rx: "0.7", fill: "#73a68e" }],
  ["rect", { x: "31", y: "59.6", width: "11", height: "1.5", rx: "0.7", fill: "#7f9cf0" }],
  [
    "g",
    { stroke: WHITE, "stroke-width": "1", "stroke-linecap": "round" },
    ["path", { d: "M80 25V29M80 35V39M73 32H77M83 32H87" }],
  ],
  ["circle", { cx: "80", cy: "32", r: "0.9", fill: WHITE }],
  [
    "rect",
    { x: "128", y: "6", width: "24", height: "5", rx: "1", fill: WHITE, "fill-opacity": "0.08" },
  ],
]);

const FIELD = {
  body: "M0 0H112C106 9 118 17 111 27C104 37 120 44 115 54C112 59 116 64 116 64H0Z",
  frame: box(34, 14, 46, 30),
  lights: [],
  object: box(91, 34, 12, 14),
  sea: "M112 0H160V64H116C116 64 112 59 115 54C120 44 104 37 111 27C118 17 106 9 112 0Z",
  spot: dot(57, 29),
  zone: "M40 15L72 10L86 28L74 46L46 44L34 30Z",
};

const FIELD_VARIANTS = {
  trees: {
    over: {
      craft:
        "M12 32A4 4 0 1 0 20 32A4 4 0 1 0 12 32ZM19 38A3.5 3.5 0 1 0 26 38A3.5 3.5 0 1 0 19 38ZM48 12A4 4 0 1 0 56 12A4 4 0 1 0 48 12ZM56 18A3.4 3.4 0 1 0 62.8 18A3.4 3.4 0 1 0 56 18ZM66 52A4 4 0 1 0 74 52A4 4 0 1 0 66 52ZM74 56A3.4 3.4 0 1 0 80.8 56A3.4 3.4 0 1 0 74 56ZM84 14A3.6 3.6 0 1 0 91.2 14A3.6 3.6 0 1 0 84 14Z",
      object: box(46, 8, 18, 14),
    },
    draw: (craft) => [
      [
        "path",
        {
          d: craft,
          fill: "#2f4a24",
          stroke: "#000000",
          "stroke-opacity": "0.2",
          "stroke-width": "0.5",
        },
      ],
    ],
  },
};

const fieldArt = planned(({ id, variant }) => {
  const extra = variantOf(FIELD_VARIANTS, variant);
  return [
    diagonal(`sea-${id}`, [
      ["0", "#2f6b8c"],
      ["1", "#1c3c52"],
    ]),
    wash(`url(#sea-${id})`),
    [
      "path",
      {
        d: FIELD.body,
        fill: "none",
        stroke: "#7cc4ec",
        "stroke-opacity": "0.25",
        "stroke-width": "6",
      },
    ],
    slab(FIELD.body, "#4f6b3d"),
    [
      "path",
      {
        d: "M8 6C22 2 34 10 30 18C26 25 12 24 7 17C4 12 4 8 8 6Z",
        fill: "#668550",
        "fill-opacity": "0.6",
      },
    ],
    [
      "g",
      { fill: "none", "stroke-linecap": "round" },
      [
        "path",
        {
          d: "M36 -2C39 16 33 30 43 66M0 22C14 24 22 18 37 20",
          stroke: "#cfd6dc",
          "stroke-opacity": "0.5",
          "stroke-width": "0.9",
        },
      ],
      [
        "path",
        {
          d: "M-2 47C26 41 54 53 82 40C96 33 104 30 113 25",
          stroke: "#eef1f3",
          "stroke-width": "2",
        },
      ],
    ],
    ...(extra ? extra.draw(extra.over.craft) : []),
    [
      "path",
      {
        d: "M97 48C97 48 92.5 42.5 92.5 39.5A4.5 4.5 0 0 1 101.5 39.5C101.5 42.5 97 48 97 48Z",
        fill: "#e8eaed",
        stroke: "#0c0d10",
        "stroke-opacity": "0.5",
        "stroke-width": "0.6",
      },
    ],
    ["circle", { cx: "97", cy: "39.5", r: "1.6", fill: "#4f6b3d" }],
  ];
});

const RANGE = {
  body: "M0 0H160V42H0Z",
  frame: box(112, 10, 26, 44),
  lights: [[125, 30]],
  object: box(114, 11, 22, 44),
  spot: dot(125, 30),
};

const RANGE_VARIANTS = {
  tracer: {
    over: { craft: "M4 39L118 30.2V31.8L4 41Z", spot: dot(118, 31), object: box(4, 29, 114, 12) },
    draw: () => [
      [
        "path",
        {
          d: "M4 40L118 31",
          stroke: WHITE,
          "stroke-opacity": "0.45",
          "stroke-width": "1.4",
          "stroke-linecap": "round",
        },
      ],
    ],
  },
  fire: {
    over: {
      craft: "M72 54C62 54 59 46 63 39C65 35 64 31 66 27C68 33 72 33 73 29C76 34 81 38 80 45C79 51 76 54 72 54Z",
      spot: dot(72, 42),
      object: box(59, 27, 22, 27),
      lights: [[72, 42]],
    },
    draw: (craft) => [
      slab(craft, "#d8703a"),
      slab(
        "M72 54C67 54 66 49 68 45C69 43 70 41 71 39C73 43 76 45 76 48C76 52 74 54 72 54Z",
        "#f2c27a",
      ),
    ],
  },
  cover: {
    over: { craft: "M36 32H64V54H36Z", spot: dot(50, 43), object: box(36, 32, 28, 22) },
    draw: (craft) => [
      slab(craft, "#4a4036"),
      [
        "path",
        {
          d: "M36 32L64 54M64 32L36 54M36 43H64",
          stroke: "#000000",
          "stroke-opacity": "0.25",
          "stroke-width": "0.8",
        },
      ],
    ],
  },
};

const rangeArt = planned(({ variant }) => {
  const extra = variantOf(RANGE_VARIANTS, variant);
  return [
    ["rect", { width: "160", height: "42", fill: "#24262b" }],
    [
      "path",
      { d: "M0 14H160M0 28H160", stroke: WHITE, "stroke-opacity": "0.04", "stroke-width": "0.8" },
    ],
    slab("M0 42H160V64H0Z", "#18191c"),
    [
      "path",
      {
        d: "M0 64L60 42M50 64L80 42M110 64L100 42M160 64L120 42",
        stroke: WHITE,
        "stroke-opacity": "0.06",
        "stroke-width": "0.7",
      },
    ],
    ["circle", { cx: "125", cy: "17", r: "4.4", fill: "#3d4148" }],
    slab("M117 54V30C117 25 120 22.5 125 22.5C130 22.5 133 25 133 30V54Z", "#3d4148"),
    ...[5.5, 2.4].map((r) => [
      "circle",
      {
        cx: "125",
        cy: "33",
        r,
        fill: "none",
        stroke: "#d97b75",
        "stroke-opacity": "0.8",
        "stroke-width": "0.9",
      },
    ]),
    slab("M6 36H34V40H6Z", "#33363c"),
    ...(extra ? extra.draw(extra.over.craft) : []),
  ];
});

const RIFLE = {
  body:
    "M16 30Q16 28 18 28L42 29L44 30V40L38 41L20 46Q16 46.5 16 44.5ZM44 26.5H94V40H44ZM94 28.5H138Q140 28.5 140 30V36Q140 37.5 138 37.5H94ZM140 31.5H158V34.5H140ZM58 40H66.5L63.5 53Q63 54.3 61.5 54.3H56ZM73 40H84L87 48L89 56L79 57.5L76.5 49Z",
  frame: box(48, 30, 30, 7),
  lights: [[150, 33]],
  object: box(60, 16, 30, 8),
  route: "M24 38C36 31 48 37 60 32C74 27 88 36 104 31C116 28 126 32 134 33",
  spot: dot(70, 33),
};

const weaponAnchors = (_variant, shape) => (shape ? weaponFromShape(shape) : { ...RIFLE });

const weaponArt = planned(({ id, shape }) => {
  const hull = shape
    ? [
        [
          "path",
          {
            d: shape.path,
            transform: weaponFromShape(shape).bodyTransform,
            fill: "#3b3f46",
            "fill-rule": "evenodd",
          },
        ],
      ]
    : [
        slab(RIFLE.body, "#3b3f46"),
        slab("M60 16H90V24H60Z", "#2c2f35"),
        ["rect", { x: "64", y: "17.5", width: "22", height: "5", rx: "2.5", fill: "#4a4f57" }],
        [
          "path",
          {
            d: "M50 26.5V24H54V26.5M122 28.5V25H125V28.5",
            stroke: "#4a4f57",
            "stroke-width": "1",
            fill: "none",
          },
        ],
        [
          "path",
          { d: "M44 26.5H138", stroke: WHITE, "stroke-opacity": "0.12", "stroke-width": "0.6" },
        ],
      ];
  return [
    halo(`studio-${id}`, "0.45", "0.75", [
      ["0", "#24272d"],
      ["1", "#0b0c0e"],
    ]),
    wash(`url(#studio-${id})`),
    ...hull,
  ];
});

const OUTFIT = {
  body: "M58 10L70 6Q80 12 90 6L102 10L114 22L104 28L100 24V58H60V24L56 28L46 22Z",
  frame: box(70, 20, 20, 16),
  lights: [],
  object: box(46, 6, 68, 52),
  route: "M64 46C70 36 76 48 82 38C86 32 92 36 96 42",
  spot: dot(80, 28),
};

const outfitArt = planned(({ id }) => [
  halo(`outfit-${id}`, "0.4", "0.8", [
    ["0", "#24272d"],
    ["1", "#0b0c0e"],
  ]),
  wash(`url(#outfit-${id})`),
  slab(OUTFIT.body, "#3b3f46"),
  [
    "path",
    {
      d: "M70 6Q80 12 90 6",
      stroke: WHITE,
      "stroke-opacity": "0.2",
      "stroke-width": "0.8",
      fill: "none",
    },
  ],
  [
    "path",
    { d: "M100 24V58M60 24V58", stroke: "#000000", "stroke-opacity": "0.2", "stroke-width": "0.8" },
  ],
]);

const SHEET = {
  body: "M18 10H74V38H18ZM86 10H142V30H86ZM86 36H142V56H86ZM18 44H74V56H18Z",
  frame: box(22, 14, 48, 20),
  lights: [],
  object: box(86, 36, 56, 20),
  spot: dot(114, 24),
};

const sheetArt = planned(({ id }) => [
  [
    "defs",
    {},
    [
      "pattern",
      { id: `check-${id}`, width: "8", height: "8", patternUnits: "userSpaceOnUse" },
      ["rect", { width: "8", height: "8", fill: "#1a1b1e" }],
      ["rect", { width: "4", height: "4", fill: "#222428" }],
      ["rect", { x: "4", y: "4", width: "4", height: "4", fill: "#222428" }],
    ],
  ],
  wash(`url(#check-${id})`),
  [
    "path",
    {
      d: SHEET.body,
      fill: "#3b3f46",
      stroke: WHITE,
      "stroke-opacity": "0.22",
      "stroke-width": "0.6",
    },
  ],
]);

const SOUND = {
  body: "M0 0H160V64H0Z",
  frame: box(20, 14, 120, 36),
  lights: [],
  object: box(20, 14, 120, 36),
  spot: dot(80, 32),
};

const WAVE_HEIGHTS = [
  6, 10, 16, 22, 14, 26, 30, 20, 12, 24, 32, 18, 10, 22, 28, 16, 8, 14, 20, 12, 6, 10, 16, 8,
];

const soundArt = planned(() => [
  wash("#111215"),
  ["path", { d: "M0 32H160", stroke: WHITE, "stroke-opacity": "0.06", "stroke-width": "0.7" }],
  [
    "g",
    { class: "tdm-wave" },
    ...WAVE_HEIGHTS.map((bar, i) => [
      "rect",
      {
        class: "tdm-bar",
        x: 22 + i * 4.9,
        y: 32 - bar / 2,
        width: "2.6",
        height: bar,
        rx: "1.3",
        fill: "#d6d9de",
        style: { "--i": i },
      },
    ]),
  ],
]);

const withVariant = (base, table, variant) => {
  const found = variantOf(table, variant);
  return { ...base, ...(found && found.over) };
};

export const GROUNDS = Object.freeze({
  hall: { anchors: HALL, Art: hallArt },
  facade: { anchorsFor: (v) => withVariant(FACADE, FACADE_VARIANTS, v), Art: facadeArt },
  street: { anchorsFor: (v) => withVariant(STREET, STREET_VARIANTS, v), Art: streetArt },
  sky: { anchorsFor: skyAnchors, Art: skyArt },
  hud: { anchors: HUD, Art: hudArt },
  field: { anchorsFor: (v) => withVariant(FIELD, FIELD_VARIANTS, v), Art: fieldArt },
  range: { anchorsFor: (v) => withVariant(RANGE, RANGE_VARIANTS, v), Art: rangeArt },
  weapon: { anchorsFor: weaponAnchors, Art: weaponArt },
  outfit: { anchors: OUTFIT, Art: outfitArt },
  sheet: { anchors: SHEET, Art: sheetArt },
  sound: { anchors: SOUND, Art: soundArt },
});

// ---------------------------------------------------------------------------
// Полоска целиком: показ, повтор по наведению, сборка рисунка и действия.
// ---------------------------------------------------------------------------

const VIGNETTE = (id) => [
  [
    "rect",
    { width: DEMO_W, height: DEMO_H, fill: `url(#tdm-vignette-${id})`, "pointer-events": "none" },
  ],
  halo(`tdm-vignette-${id}`, "0.45", "0.75", [
    ["0.6", "#000", "0"],
    ["1", "#000", "0.36"],
  ]),
];

// Номер показа и отметка времени последнего показа живут вместе: наведение
// считается новым показом, только если с прошлого прошло не меньше паузы.
const useReplays = () => {
  const [round, setRound] = useState(0);
  const shownAt = useRef(0);

  useEffect(() => {
    shownAt.current = performance.now();
  }, []);

  const onEnter = () => {
    const now = performance.now();
    if (now - shownAt.current >= REPLAY_GAP_MS) {
      shownAt.current = now;
      setRound((n) => n + 1);
    }
  };
  return [round, onEnter];
};

const alnum = (text) => Array.from(text, (ch) => (/[a-z0-9]/i.test(ch) ? ch : "")).join("");

// Земля по имени (запасная — facade) и якоря: сначала сцены, поверх них поправка.
const resolveScene = ({ focus, ground, shape, variant }) => {
  const entry = GROUNDS[ground] || GROUNDS.facade;
  const { Art } = entry;
  let table = entry.anchors;
  if (typeof entry.anchorsFor === "function") table = entry.anchorsFor(variant, shape);
  if (!focus) return { Art, anchors: table };
  return { Art, anchors: { ...table, ...focus } };
};

const SVG_FRAME = {
  viewBox: `0 0 ${DEMO_W} ${DEMO_H}`,
  preserveAspectRatio: "xMidYMid slice",
  "aria-hidden": "true",
  focusable: "false",
};

export default function ToolDemo({
  ground,
  kind,
  label,
  toolId = "",
  variant = "",
  target = "",
  focus = null,
  shape = null,
}) {
  const id = alnum(useId());
  const [round, onEnter] = useReplays();
  const { Art, anchors } = resolveScene({ ground, variant, shape, focus });
  const Action = ACTIONS[kind] || ACTIONS.paint;

  return make(
    "div",
    {
      className: `ui-tool-demo is-${kind} on-${ground}`,
      role: "img",
      "aria-label": label,
      "data-tone": round % 2 ? "b" : undefined,
      onPointerEnter: onEnter,
    },
    make(
      "svg",
      { key: round, ...SVG_FRAME },
      make(Art, { id, variant, kind, shape }),
      make(Action, { id, anchors, toolId, target }),
      ...VIGNETTE(id).map((node) => build(node)),
    ),
  );
}
