import { Fragment, createElement as el, memo, useId, useMemo, useRef } from "react";
import { LabelsGpuLayer, labelsGpuAvailable } from "./world-map/gpu/labels-layer.jsx";
import { labelsForScene } from "./world-map/gpu/labels-scene.js";
import { mapRendererMode } from "./world-map/gpu/map-renderer-flag.js";
import { READABLE_PX, isGradientPaint, paintBox, paintLine } from "@modovik/vector-map";
import { createSceneCuller } from "./world-map-cull.js";
import { measureTextAdvance } from "./world-map-text-measure.js";

const NOT_ID_CHAR = /[^A-Za-z0-9_-]/g;
const NOT_HEX_DIGIT = /[^0-9a-f]/gi;
const AUDIT_IGNORE = "type-min type-scale caps";
const SHARPEN_KERNEL = "0 -0.35 0 -0.35 2.4 -0.35 0 -0.35 0";
const BATCH_ABOVE = 8;
const APPEAR = 1;
const VANISH = 2;
// Пустое множество по умолчанию одно на модуль: ссылка не меняется, memo слоёв держится.
const NO_IDS = new Set();

const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);
const keyOf = (item) => item.id ?? item.kind;

function hasCyrillic(text) {
  let at = text.length;
  while (at--) {
    const code = text.charCodeAt(at);
    if (code >= 0x400 && code <= 0x4ff) return true;
  }
  return false;
}

// ---- общие атрибуты примитива ----

function effectStyle(item, tail) {
  const shadow = [
    item.blur ? `blur(${item.blur}px)` : null,
    item.glow ? `drop-shadow(0 0 ${item.glow.size}px ${item.glow.color})` : null,
  ].filter(Boolean);
  const style = {
    ...(shadow.length ? { filter: shadow.join(" ") } : null),
    ...(item.blend ? { mixBlendMode: item.blend } : null),
    ...tail,
  };
  return Object.keys(style).length ? style : undefined;
}

function placement(item) {
  const pivot = item.origin || item;
  const steps = [
    item.rotation ? `rotate(${item.rotation} ${pivot.x} ${pivot.y})` : null,
    item.flip ? `translate(${(item.x + (item.width || 0) / 2) * 2} 0) scale(-1 1)` : null,
  ].filter(Boolean);
  return steps.length ? steps.join(" ") : undefined;
}

const dashOf = (item) => (item.dash ? item.dash.join(" ") : undefined);

// Таблица атрибутов: [имя в DOM, поле примитива или функция (примитив, общее) => значение].
// Порядок строк и есть порядок атрибутов в разметке.
function attrsFrom(table, item, shared) {
  return Object.fromEntries(
    table.map(([prop, source]) => {
      const value = typeof source === "function" ? source(item, shared) : item[source];
      return [prop, value];
    }),
  );
}

// ---- краска-полоса ----

const PAINT_SLOTS = [
  ["fill", "f"],
  ["stroke", "s"],
];

function gradientDef(tag, id, line, stops) {
  const ends = { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 };
  const points = stops.map(([offset, color], i) =>
    el("stop", { key: i, offset, stopColor: color }),
  );
  const gradient = el("linearGradient", { id, gradientUnits: "userSpaceOnUse", ...ends }, points);
  return el("defs", { key: tag }, gradient);
}

function resolvePaints(item, shared) {
  const defs = [];
  const [fill, stroke] = PAINT_SLOTS.map(([field, tag]) => {
    const paint = item[field];
    if (!isGradientPaint(paint)) return paint;
    const id = `${shared.scope}-paint-${shared.uid}-${tag}`;
    defs.push(gradientDef(tag, id, paintLine(paint, paintBox(item)), paint.stops));
    return `url(#${id})`;
  });
  return { defs, fill, stroke };
}

// ---- виды примитивов ----

const RECT_ATTRS = [
  ["x", "x"],
  ["y", "y"],
  ["width", "width"],
  ["height", "height"],
  ["rx", (it) => it.radius || undefined],
  ["fill", (it, s) => s.paints.fill || "none"],
  ["stroke", (it, s) => s.paints.stroke || undefined],
  ["strokeWidth", (it, s) => (s.paints.stroke ? it.strokeWidth : undefined)],
  ["opacity", "opacity"],
  ["transform", (it) => placement(it)],
  ["style", (it) => effectStyle(it)],
];

const PATH_ATTRS = [
  ["d", "d"],
  ["fill", (it) => it.fill || "none"],
  ["fillOpacity", "fillOpacity"],
  ["stroke", (it) => it.stroke || "none"],
  ["strokeWidth", "strokeWidth"],
  ["strokeOpacity", "strokeOpacity"],
  ["strokeLinejoin", "lineJoin"],
  ["strokeLinecap", "lineCap"],
  ["strokeDasharray", (it) => dashOf(it)],
  ["clipPath", (it, s) => (s.clipId ? `url(#${s.clipId})` : undefined)],
  ["opacity", "opacity"],
  ["style", (it) => effectStyle(it)],
];

const CIRCLE_ATTRS = [
  ["cx", "x"],
  ["cy", "y"],
  ["r", (it) => Math.max(0, it.r)],
  ["fill", (it, s) => s.paints.fill || "none"],
  ["stroke", (it, s) => s.paints.stroke || "none"],
  ["strokeWidth", "strokeWidth"],
  ["strokeOpacity", "strokeOpacity"],
  ["strokeDasharray", (it) => dashOf(it)],
  ["opacity", "opacity"],
  ["style", (it) => effectStyle(it)],
];

const GLYPH_ATTRS = [
  ["d", "path"],
  ["fill", (it, s) => s.paints.fill],
  ["stroke", (it, s) => s.paints.stroke || undefined],
  ["strokeWidth", (it, s) => (s.inked ? it.strokeWidth / s.scale : undefined)],
  ["strokeLinejoin", (it, s) => (s.inked ? "round" : undefined)],
  ["strokeLinecap", (it, s) => (s.inked ? "round" : undefined)],
  ["paintOrder", (it, s) => (s.inked ? "stroke" : undefined)],
  ["transform", (it, s) => `translate(${it.x - s.half} ${it.y - s.half}) scale(${s.scale})`],
];

const IMAGE_ATTRS = [
  ["href", "href"],
  ["x", "x"],
  ["y", "y"],
  ["width", "width"],
  ["height", "height"],
  ["opacity", (it, s) => (s.own ? it.opacity : undefined)],
  ["preserveAspectRatio", (it) => it.preserveAspectRatio || "none"],
  ["clipPath", (it, s) => (s.rounded ? `url(#${s.clipId})` : undefined)],
  ["filter", (it, s) => (s.tintId ? `url(#${s.tintId})` : undefined)],
  ["transform", (it, s) => (s.own ? placement(it) : undefined)],
  ["style", (it, s) => (s.own ? effectStyle(it) : undefined)],
];

const TEXT_ATTRS = [
  ["data-audit-ignore", () => AUDIT_IGNORE],
  ["lang", (it, s) => (hasCyrillic(s.sample) ? "ru" : undefined)],
  ["x", (it, s) => s.fit.x],
  ["y", "y"],
  ["fontSize", "size"],
  ["fontFamily", "family"],
  ["fontWeight", "weight"],
  ["letterSpacing", (it, s) => s.fit.spacing],
  ["textAnchor", "anchor"],
  ["dominantBaseline", "baseline"],
  ["fill", "fill"],
  ["stroke", (it) => it.stroke || "none"],
  ["strokeWidth", (it) => (it.strokeWidth ? it.strokeWidth * 2 : undefined)],
  ["strokeLinejoin", () => "round"],
  ["paintOrder", () => "stroke"],
  ["opacity", "opacity"],
  ["textLength", (it, s) => s.fit.length],
  ["lengthAdjust", (it, s) => s.fit.adjust],
  ["transform", (it) => placement(it)],
  ["data-floor", (it, s) => (s.vars ? "" : undefined)],
  ["style", (it, s) => effectStyle(it, { whiteSpace: "pre", ...s.vars })],
];

function drawRect(item, shared) {
  const paints = resolvePaints(item, shared);
  return el(Fragment, null, ...paints.defs, el("rect", attrsFrom(RECT_ATTRS, item, { paints })));
}

function drawPath(item, shared) {
  const clipId = item.clip ? `${shared.scope}-clip-${item.id}` : undefined;
  const cutter = clipId && el("clipPath", { id: clipId }, el("path", { d: item.d }));
  return el(Fragment, null, cutter || null, el("path", attrsFrom(PATH_ATTRS, item, { clipId })));
}

function drawCircle(item, shared) {
  const paints = resolvePaints(item, shared);
  const circle = el("circle", attrsFrom(CIRCLE_ATTRS, item, { paints }));
  return el(Fragment, null, ...paints.defs, circle);
}

function drawGlyph(item, shared) {
  const paints = resolvePaints(item, shared);
  const scale = item.size / item.box;
  const side = item.size * 1.44;
  const plate = item.badge
    ? el("rect", {
        x: item.x - item.size * 0.72,
        y: item.y - item.size * 0.72,
        width: side,
        height: side,
        rx: item.size * 0.34,
        fill: item.badge.fill,
      })
    : null;
  const known = { paints, scale, half: item.size / 2, inked: Boolean(paints.stroke) };
  return el(
    "g",
    { opacity: item.opacity, style: effectStyle(item) },
    plate,
    ...paints.defs,
    el("path", attrsFrom(GLYPH_ATTRS, item, known)),
  );
}

function drawImage(item, shared) {
  const rounded = item.radius > 0;
  const clipId = `${shared.scope}-image-clip-${item.id}`;
  const tintName = item.tint ? String(item.tint).replace(NOT_HEX_DIGIT, "") : null;
  const tintId = item.tint ? `${shared.scope}-tint-${tintName}` : null;
  const box = { x: item.x, y: item.y, width: item.width, height: item.height };
  const filterSpec = { id: tintId, x: "0", y: "0", width: "100%", height: "100%" };
  const pieces = [
    rounded
      ? el("defs", null, el("clipPath", { id: clipId }, el("rect", { ...box, rx: item.radius })))
      : null,
    tintId
      ? el(
          "defs",
          null,
          el(
            "filter",
            { ...filterSpec, colorInterpolationFilters: "sRGB" },
            el("feFlood", { floodColor: item.tint, result: "tint" }),
            el("feComposite", { in: "tint", in2: "SourceAlpha", operator: "in" }),
          ),
        )
      : null,
    el("image", attrsFrom(IMAGE_ATTRS, item, { rounded, clipId, tintId, own: !rounded })),
  ].filter(Boolean);
  if (!rounded) return el(Fragment, null, ...pieces);
  const wrapper = { opacity: item.opacity, transform: placement(item), style: effectStyle(item) };
  return el("g", wrapper, ...pieces);
}

// Подгонка ширины подписи: разрядка по замеру шрифта, запасной путь — textLength.
function fitText(item) {
  const forced = item.fitWidth && !item.measured;
  const fit = {
    x: item.x,
    spacing: item.letterSpacing,
    length: forced ? item.fitWidth : undefined,
    adjust: forced ? "spacingAndGlyphs" : undefined,
  };
  if (!item.fitSpacing) return fit;
  const em = item.size ?? 12;
  const chars = String(item.value ?? "").length;
  const advance =
    chars < 2
      ? null
      : measureTextAdvance({
          value: item.value,
          family: item.family,
          weight: item.weight || 400,
          spacing: ((item.letterSpacing || 0) * 100) / em,
        });
  if (typeof advance === "number") {
    fit.spacing = (item.fitSpacing - advance * em) / (chars - 1);
    if (item.anchor === "middle") fit.x = item.x + fit.spacing / 2;
  } else if (fit.length === undefined) {
    Object.assign(fit, { length: item.fitSpacing, adjust: "spacing" });
  }
  return fit;
}

// Порог читаемости: числа для правила слоя, постоянного transform у подписи нет.
function floorVars(item, x) {
  if (!(item.floor > 0 && item.size > 0)) return null;
  const rounded = (v) => Math.round(v * 10000) / 10000;
  const spot = item.rotation && item.origin ? item.origin : { x, y: item.y };
  return {
    "--wm-u": String(rounded(Math.min(1, item.floor / item.size))),
    "--wm-c": String(rounded(READABLE_PX / item.size)),
    "--wm-ox": `${spot.x}px`,
    "--wm-oy": `${spot.y}px`,
    ...(item.rotation ? { "--wm-r": `${item.rotation}deg` } : null),
  };
}

const lineShift = (item, count, at) =>
  at === 0 ? (-(count - 1) / 2) * item.lineStep : item.lineStep;

function drawText(item) {
  const fit = fitText(item);
  const lines = item.lines && item.lines.length > 1 ? item.lines : null;
  const shared = {
    fit,
    vars: floorVars(item, fit.x),
    sample: lines ? lines.join(" ") : String(item.value ?? ""),
  };
  const content = lines
    ? lines.map((line, at) =>
        el(
          "tspan",
          {
            key: at,
            "data-audit-ignore": AUDIT_IGNORE,
            x: fit.x,
            dy: lineShift(item, lines.length, at),
          },
          line,
        ),
      )
    : item.value;
  return el("text", attrsFrom(TEXT_ATTRS, item, shared), content);
}

const DRAWERS = {
  rect: drawRect,
  path: drawPath,
  circle: drawCircle,
  glyph: drawGlyph,
  image: drawImage,
  text: drawText,
};

const Primitive = memo(function Primitive({ item, scope }) {
  const uid = useId().replace(NOT_ID_CHAR, "");
  const draw = lookup(DRAWERS, item.kind);
  return draw ? draw(item, { scope, uid }) : null;
});

// ---- слой: вход и уход примитивов ----

// Обёртки входа и ухода: у одиночной своя задержка, у общей — наименьшая.
const CRATES = {
  [APPEAR]: {
    key: "~appear",
    solo: (delay) => ({
      className: "wmc-appear",
      style: delay ? { animationDelay: `${delay}ms` } : undefined,
    }),
    batch: (delay) => ({
      className: "wmc-appear is-batch",
      style: delay > 0 ? { animationDelay: `${delay}ms` } : undefined,
    }),
  },
  [VANISH]: {
    key: "~vanish",
    solo: () => ({ className: "wmc-vanish", pointerEvents: "none" }),
    batch: () => ({ className: "wmc-vanish is-batch", pointerEvents: "none" }),
  },
};

function arrangeItems(items, fresh, leaving, scope) {
  const crowds = { [APPEAR]: [], [VANISH]: [] };
  const fates = items.map((item, at) => {
    let fate = 0;
    if (leaving.has(item.id)) fate = VANISH;
    else if (fresh.has(item.id)) fate = APPEAR;
    if (fate) crowds[fate].push(at);
    return fate;
  });
  const delayOf = (at) => (typeof fresh.get === "function" ? fresh.get(items[at].id) : undefined);
  const plain = (item) => el(Primitive, { key: keyOf(item), item, scope });

  return items.flatMap((item, at) => {
    const fate = fates[at];
    if (!fate) return [plain(item)];
    const crowd = crowds[fate];
    const crate = CRATES[fate];
    if (crowd.length <= BATCH_ABOVE) {
      const own = fate === APPEAR ? delayOf(at) : undefined;
      return [el("g", { key: keyOf(item), ...crate.solo(own) }, plain(item))];
    }
    if (crowd[0] !== at) return [];
    const earliest = (least, i) => Math.min(least, Number(delayOf(i)) || 0);
    const soonest = fate === APPEAR ? crowd.reduce(earliest, Infinity) : 0;
    const members = crowd.map((i) => plain(items[i]));
    return [el("g", { key: crate.key, ...crate.batch(soonest) }, ...members)];
  });
}

const Layer = memo(function Layer({ layer, fresh = NO_IDS, leaving = NO_IDS, scope = "map" }) {
  const effects = [
    layer.filter && layer.filter !== "none" ? layer.filter : null,
    layer.sharpen ? `url(#${scope}-sharpen)` : null,
    layer.blur > 0 ? `blur(${layer.blur}px)` : null,
  ].filter(Boolean);
  const style = effects.length ? { filter: effects.join(" ") } : undefined;
  const children = arrangeItems(layer.items, fresh, leaving, scope);
  return el("g", { "data-layer": layer.id, style }, children);
});

// ---- сцена по частям ----

function cutScene(cullerRef, scene, box) {
  if (!cullerRef.current) cullerRef.current = createSceneCuller();
  return cullerRef.current(scene, box);
}

function sharpenDefs(scope) {
  const matrix = { order: "3", kernelMatrix: SHARPEN_KERNEL, edgeMode: "duplicate" };
  const kernel = el("feConvolveMatrix", matrix);
  return el("defs", null, el("filter", { id: `${scope}-sharpen` }, kernel));
}

// Подложка за краем карты проходит через ту же цветокоррекцию, что слой base.
function backdropLayer(scene, backdrop, frame) {
  if (!(backdrop && frame)) return null;
  const base = scene.layers.find((layer) => layer.id === "base");
  const { x, y, width, height } = frame;
  const field = { kind: "rect", id: "backdrop-fill", x, y, width, height, fill: backdrop };
  // тот же слой и тот же примитив, что у слоёв сцены; объект слоя новый на каждой отрисовке
  const layer = { id: "backdrop", filter: base ? base.filter : undefined, items: [field] };
  return el(Layer, { layer });
}

function interactiveBody({ world, children, hit, hitProps, clip, scene }) {
  const area = clip || { x: 0, y: 0, width: scene.width, height: scene.height };
  const target = {
    className: `wmc-hit ${hit}`.trim(),
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    fill: "none",
    pointerEvents: "all",
    ...hitProps,
  };
  return el(
    Fragment,
    null,
    el("g", { className: "wmc-world", pointerEvents: "none" }, world),
    el("rect", target),
    el("g", { className: "wmc-marks", pointerEvents: "none" }, children),
  );
}

export default function MapScene({
  scene,
  backdrop = "",
  frame = null,
  fresh = NO_IDS,
  leaving = NO_IDS,
  clip = null,
  hit = null,
  hitProps = null,
  children = null,
  ...rest
}) {
  const scope = "map" + useId().replace(NOT_ID_CHAR, "");
  const cullerRef = useRef(null);

  // кадр сравнивается по четырём числам, а не по объекту
  const clipped = Boolean(clip);
  const [cx, cy, cw, ch] = clip ? [clip.x, clip.y, clip.width, clip.height] : [];
  const drawn = useMemo(
    () => (clipped ? cutScene(cullerRef, scene, { x: cx, y: cy, width: cw, height: ch }) : scene),
    [scene, clipped, cx, cy, cw, ch],
  );

  const view = useMemo(() => {
    const split = labelsForScene(drawn.layers, { enabled: mapRendererMode() === "gpu" });
    const onGpu = split.runs.length > 0 && labelsGpuAvailable();
    if (!onGpu) return { layers: drawn.layers, runs: null };
    return { layers: split.layers, runs: split.runs };
  }, [drawn]);

  const layers = view.layers.map((layer, at) =>
    el(Layer, { key: layer.id ?? at, layer, fresh, leaving, scope }),
  );
  const { width, height } = scene;
  const gpu = view.runs ? el(LabelsGpuLayer, { runs: view.runs, width, height }) : null;
  const world = el(Fragment, null, backdropLayer(scene, backdrop, frame), layers, gpu);
  const body =
    hit === null
      ? el(Fragment, null, world, children)
      : interactiveBody({ world, children, hit, hitProps, clip, scene });

  return el(
    "svg",
    { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "xMidYMid meet", ...rest },
    scene.layers.some((layer) => layer.sharpen) ? sharpenDefs(scope) : null,
    body,
  );
}
