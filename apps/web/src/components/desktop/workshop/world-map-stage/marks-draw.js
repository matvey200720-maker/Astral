// Отметки рисования: контуры дорисовки, рамка выделения, призрак фигуры, след ластика,
// живой мазок, кольцо под курсором, черновик зоны. Узлы с руками-правками получают ref.
import { createElement as h } from "react";
import { boxFromCorners, shapePoints } from "@modovik/vector-map";

const WHITE = "#ffffff";

const pairOf = (unit, first, second) => `${first * unit} ${second * unit}`;
const through = (points) => points.map((one) => `${one.x} ${one.y}`).join("L");

// Контуры дорисовки новых зон (первые дети группы отметок)
export function drawOnContours(fresh, unit) {
  return fresh.map(({ id, item }) =>
    h("path", {
      key: `fresh-${id}`,
      className: "wmc-draw-on",
      d: item.d,
      pathLength: 1,
      fill: "none",
      stroke: item.stroke || WHITE,
      strokeWidth: Math.max(item.strokeWidth || 0, 2.2 * unit),
      strokeLinecap: "round",
      strokeLinejoin: "round",
      pointerEvents: "none",
    }),
  );
}

export function marqueeMark(marquee, projector, unit) {
  if (!marquee) return null;
  const a = projector.point(marquee.a);
  const b = projector.point(marquee.b);
  return h("rect", {
    key: "marquee",
    className: "wmc-marquee",
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
    strokeWidth: 1.2 * unit,
  });
}

// ——— призрак фигуры, пока растягивают ———
const LINE_DASH = {
  dashed: (width) => `${width * 3.4} ${width * 2.4}`,
  dotted: (width) => `0.001 ${width * 2.2}`,
};

export function shapeGhost({ stretch, shape, shapeLook, config, projector, unit, zoom }) {
  if (!stretch || shape === "free") return null;
  const box = boxFromCorners(stretch.start, stretch.end, stretch.square);
  if (!(box.w >= 1 && box.h >= 1)) return null;
  const points = shapePoints(shape, box);
  if (points.length < 3) return null;
  const color = shapeLook?.color || WHITE;
  const base = shapeLook?.width ?? config.zones.strokeWidth;
  const width = Math.max(1.4 * unit, base * Math.pow(Math.min(40, Math.max(1, zoom)), -0.68));
  const line = shapeLook?.line;
  const dash = Object.prototype.hasOwnProperty.call(LINE_DASH, line) ? LINE_DASH[line](width) : undefined;
  return h("path", {
    key: "shape-ghost",
    className: "wmc-shape-ghost",
    d: `M${through(points.map((one) => projector.point(one)))}Z`,
    fill: shapeLook?.fill === false ? "none" : color,
    fillOpacity: 0.22,
    stroke: color,
    strokeWidth: width,
    strokeDasharray: dash,
    strokeLinecap: line === "dotted" ? "round" : "butt",
    strokeLinejoin: "round",
    pointerEvents: "none",
  });
}

// ——— ластик и кисть ———
export function eraseTrail(trail, nodes) {
  if (!trail) return null;
  return h("path", {
    key: "erase-trail",
    className: "wmc-erase-trail",
    ref: (node) => {
      nodes.current.trail = node;
    },
    d: trail.d,
    fill: "none",
    stroke: WHITE,
    strokeWidth: trail.width,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    opacity: 0.28,
    pointerEvents: "none",
  });
}

// Живой мазок: наконечники (fill цветом) и линия; `d` дописывается прямо в узлы
export function wetStroke(wet, nodes) {
  if (!wet) return [];
  const { look } = wet;
  const keep = (at) => (node) => {
    nodes.current.wet[at] = node;
  };
  const blur = look.blur ? { filter: `blur(${look.blur}px)` } : undefined;
  const heads = Array.from({ length: wet.heads }, (_, at) =>
    h("path", {
      key: `wet-head-${at}`,
      className: "wmc-wet",
      ref: keep(at),
      d: "",
      fill: look.color,
      stroke: "none",
      strokeLinejoin: "round",
      opacity: look.opacity,
      style: blur,
      pointerEvents: "none",
    }),
  );
  const line = h("path", {
    key: "wet-line",
    className: "wmc-wet",
    ref: keep(wet.heads),
    d: wet.d,
    fill: "none",
    stroke: look.color,
    strokeWidth: look.thickness,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeDasharray: look.dash ?? undefined,
    opacity: look.opacity,
    style: blur,
    pointerEvents: "none",
  });
  return [...heads, line];
}

// Кольцо под курсором ластика или кисти; координаты пишутся в узел по движению
export function eraserRing({ tool, brush, eraserSize, projector, unit, nodes }) {
  const size = tool === "eraser" ? eraserSize : tool === "brush" && brush ? brush.size : null;
  if (size === null) return null;
  return h("circle", {
    key: "eraser-ring",
    className: "wmc-eraser-ring",
    ref: (node) => {
      nodes.current.ring = node;
    },
    r: Math.max(projector.length(size) / 2, unit),
    visibility: "hidden",
    fill: "none",
    stroke: WHITE,
    strokeWidth: 1.2 * unit,
    opacity: 0.75,
    pointerEvents: "none",
  });
}

// Черновик зоны по вершинам: ломаная, пунктир до курсора, круги вершин
export function draftZone({ draft, aim, projector, unit }) {
  if (!draft || draft.length === 0) return null;
  const spots = draft.map((one) => projector.point(one));
  const closing = Boolean(aim?.closing);
  const tail = aim && !closing ? projector.point(aim.world) : null;
  const last = spots[spots.length - 1];
  const parts = [
    h("path", {
      key: "line",
      d: `M${through(spots)}${closing ? "Z" : ""}`,
      fill: "rgba(255,255,255,0.08)",
      stroke: WHITE,
      strokeWidth: 1.6 * unit,
    }),
  ];
  if (tail) {
    parts.push(
      h("path", {
        key: "aim",
        d: `M${last.x} ${last.y}L${tail.x} ${tail.y}`,
        fill: "none",
        stroke: WHITE,
        strokeWidth: 1.4 * unit,
        strokeDasharray: pairOf(unit, 5, 4),
        opacity: 0.7,
        pointerEvents: "none",
      }),
    );
  }
  spots.forEach((spot, at) => {
    const first = at === 0 && closing;
    parts.push(
      h("circle", {
        key: `${spot.x}:${spot.y}:${at}`,
        cx: spot.x,
        cy: spot.y,
        r: (first ? 10 : 5) * unit,
        className: first ? "wmc-handle is-closing" : "wmc-handle",
      }),
    );
  });
  return h("g", { key: "draft", className: "wmc-draft" }, ...parts);
}
