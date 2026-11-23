// Отметки выбора поверх карты: рамка выбранного, остальные выбранные, подсветка под курсором.
// Размеры кратны `unit` (единиц сцены на точку экрана), поэтому постоянны на экране.
import { createElement, Fragment, memo } from "react";
import { curvePath, sceneTextBox, MARKER_CATEGORY_MAP, sceneLabelOf } from "@modovik/vector-map";
import { zoneShapeBox, emblemBox, findObject } from "../world-map-editing.js";

const h = createElement;
const WHITE = "#ffffff";
const BACKING = "rgba(4,6,10,0.65)";

// штрих и пауза пунктира в единицах `unit`
const dashOf = (unit, [on, off]) => `${on * unit} ${off * unit}`;
const through = (points) => points.map(({ x, y }) => `${x} ${y}`).join("L");
const projected = (points, projector) => points.map((one) => projector.point(one));

// Контур зоны в единицах сцены, замкнутый
export const zonePathOf = (zone, projector) => `M${through(projected(zone.points, projector))}Z`;

// Осевая мазка: кривая кисти через curvePath, иначе ломаная M…L…
export function strokeScenePath(stroke, projector) {
  const points = projected(stroke.points, projector);
  if (stroke.curve) return curvePath(points);
  return points.map(({ x, y }, at) => `${at === 0 ? "M" : "L"}${x} ${y}`).join("");
}

// ——— рамка подписи ———
function labelRect(label, unit) {
  const box = sceneTextBox(label);
  const rim = 3 * unit;
  const rect = {
    x: box.x - box.width / 2 - rim,
    y: box.y - box.height / 2 - rim,
    width: box.width + 6 * unit,
    height: box.height + 6 * unit,
    rx: 2 * unit,
    fill: "none",
    stroke: WHITE,
    strokeWidth: 1.4 * unit,
    strokeDasharray: dashOf(unit, [5, 3]),
  };
  const origin = label.origin || { x: label.x, y: label.y };
  const turn = `rotate(${label.rotation} ${origin.x} ${origin.y})`;
  return h("rect", label.rotation ? { ...rect, transform: turn } : rect);
}

const outlineOf = (unit) => ({
  fill: "none",
  stroke: WHITE,
  strokeWidth: 1.6 * unit,
  strokeDasharray: dashOf(unit, [6, 4]),
});

const wrapSelection = (...children) => h("g", { className: "wmc-selection" }, ...children);

// ——— рамка с ручками: контур, стебелёк, четыре угла, кружок поворота ———
function handleFrame(box, unit) {
  const size = 10 * unit;
  const [first, second] = box.corners;
  const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const squares = box.corners.map(({ x, y }, key) =>
    h("rect", {
      key,
      x: x - size / 2,
      y: y - size / 2,
      width: size,
      height: size,
      transform: `rotate(${box.rotation} ${x} ${y})`,
      className: "wmc-handle",
    }),
  );
  const rotate = h("circle", {
    cx: box.rotate.x,
    cy: box.rotate.y,
    r: size / 2,
    className: "wmc-handle wmc-handle-rotate",
  });
  return wrapSelection(
    h("path", { d: `M${through(box.corners)}Z`, ...outlineOf(unit) }),
    h("path", {
      d: `M${middle.x} ${middle.y}L${box.rotate.x} ${box.rotate.y}`,
      fill: "none",
      stroke: WHITE,
      strokeWidth: 1.2 * unit,
    }),
    ...squares,
    rotate,
  );
}

// ——— что строится для каждого вида выбранного ———
const BUILDERS = {
  // зона: фигура с рамкой и ручками либо контур (с вершинами у свободной)
  zone({ zone, unit, projector, handleGap, label, shapeHandles, vertexHandles }) {
    if (zone.box && shapeHandles) {
      const box = zoneShapeBox(zone, projector, handleGap);
      return box ? h(Fragment, null, label, handleFrame(box, unit)) : null;
    }
    const dots = vertexHandles
      ? zone.points.map((one, at) => {
          const { x, y } = projector.point(one);
          return h("circle", {
            key: `${x}:${y}:${at}`,
            cx: x,
            cy: y,
            r: (10 * unit) / 2,
            className: "wmc-handle",
          });
        })
      : [];
    return wrapSelection(label, h("path", { d: zonePathOf(zone, projector), ...outlineOf(unit) }), ...dots);
  },

  marker({ marker, unit, projector, label }) {
    if (MARKER_CATEGORY_MAP[marker.category]?.glyph === "none" && label) {
      return wrapSelection(label);
    }
    const { x: cx, y: cy } = projector.point(marker);
    const size = 10 * unit;
    return wrapSelection(
      label,
      h("circle", { cx, cy, r: Math.max(size * 1.6, size), ...outlineOf(unit) }),
      h("circle", { cx, cy, r: size / 2, className: "wmc-handle" }),
    );
  },

  stroke: ({ stroke, unit, projector }) =>
    wrapSelection(
      h("path", {
        d: strokeScenePath(stroke, projector),
        ...outlineOf(unit),
        strokeLinecap: "round",
        strokeLinejoin: "round",
        opacity: 0.9,
      }),
    ),

  // рамка надписи рисуется всегда; пока её печатают, отметки нет
  emblem({ emblem, unit, projector, handleGap, textAdvance, typingId }) {
    if (typingId !== undefined && typingId === emblem.id) return null;
    return handleFrame(emblemBox(emblem, projector, handleGap, textAdvance), unit);
  },
};

// Отметка выбранного; нет выбора или объекта в проекте - ничего
export const SelectionMark = memo(function SelectionMark(props) {
  const { config, selection, scene, unit } = props;
  if (!selection) return null;
  const object = findObject(config, selection);
  const build = Object.hasOwn(BUILDERS, selection.kind) ? BUILDERS[selection.kind] : null;
  if (!object || !build) return null;
  const found = sceneLabelOf(scene, selection);
  return build({ ...props, [selection.kind]: object, label: found && labelRect(found, unit) });
});

// ——— остальные выбранные ———
const OUTLINES = { zone: zonePathOf, stroke: strokeScenePath };

export const PickedMark = memo(function PickedMark({ config, target, projector, unit }) {
  const object = findObject(config, target);
  if (!object) return null;
  const wrap = (...kids) => h("g", { className: "wmc-picked", pointerEvents: "none" }, ...kids);
  const backing = { stroke: BACKING, strokeWidth: 3 * unit };
  const dashed = { stroke: WHITE, strokeWidth: 1.6 * unit };
  const outlined = Object.hasOwn(OUTLINES, target.kind) ? OUTLINES[target.kind] : null;
  if (outlined) {
    const d = outlined(object, projector);
    const fill = target.kind === "zone" ? "rgba(255,255,255,0.06)" : "none";
    return wrap(
      h("path", { d, fill, ...backing }),
      h("path", { d, fill: "none", ...dashed, strokeDasharray: dashOf(unit, [5, 3]) }),
    );
  }
  const { x: cx, y: cy } = projector.point(object);
  const ring = { cx, cy, r: 10 * unit, fill: "none" };
  return wrap(
    h("circle", { ...ring, ...backing }),
    h("circle", { ...ring, ...dashed, strokeDasharray: dashOf(unit, [3, 2]) }),
  );
});

// ——— подсветка под курсором ———
const HOVERS = {
  stroke: (object, projector, unit) =>
    h("path", {
      d: strokeScenePath(object, projector),
      fill: "none",
      stroke: "rgba(255,255,255,0.55)",
      strokeWidth: 1.4 * unit,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      pointerEvents: "none",
    }),
  zone: (object, projector) =>
    h("path", {
      d: zonePathOf(object, projector),
      fill: "rgba(255,255,255,0.12)",
      stroke: "none",
      pointerEvents: "none",
    }),
};

export const HoverMark = memo(function HoverMark({ config, hit, projector, unit }) {
  const object = findObject(config, hit);
  if (!object) return null;
  if (Object.hasOwn(HOVERS, hit.kind)) return HOVERS[hit.kind](object, projector, unit);
  const { x: cx, y: cy } = projector.point(object);
  return h("circle", {
    cx,
    cy,
    r: 9 * unit,
    fill: "none",
    stroke: "rgba(255,255,255,0.7)",
    strokeWidth: 1.4 * unit,
    pointerEvents: "none",
  });
});
