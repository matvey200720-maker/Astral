import { createElement as h, useLayoutEffect, useRef } from "react";
import { rectToQuadCss } from "./quad-transform.js";
import { tr, useTr } from "../../../locales/ui.js";

// Границы масштаба поля относительно холста надписи.
const SCALE_RANGE = [0.02, 8];
const HIDDEN = "hidden";
const WHITE = "#ffffff";
const CLEAR = "transparent";
const FINISH_KEYS = new Set(["Enter", "Escape"]);

const clamp = (n, [low, high]) => Math.min(high, Math.max(low, n));

const swallow = (event) => event.stopPropagation();

/* ---------- где поле на экране ---------- */

// Углы надписи в экранных точках `[x, y]`; null, если холста нет или точка не спроецировалась.
const screenCorners = ({ project, corners, layout }) => {
  const spots = layout ? corners?.()?.map((point) => project?.(point)) : null;
  if (!spots || spots.length !== 4 || !spots.every(Boolean)) return null;
  return spots.map(({ x, y }) => [x, y]);
};

// Масштаб по левой кромке: экранная высота надписи делится на высоту холста.
const fitToCorners = (points, shape) => {
  const [[ax, ay], , , [dx, dy]] = points;
  const scale = clamp(Math.hypot(dx - ax, dy - ay) / shape.height, SCALE_RANGE);
  return { scale, width: shape.width * scale, height: shape.height * scale };
};

// Числа для стиля уже строками: по ним же сравниваем «то же место или нет».
const readouts = (shape, { scale, width, height }) => ({
  width: width.toFixed(2),
  height: height.toFixed(2),
  font: (shape.size * scale).toFixed(3),
  stroke: ((shape.stroke || 0) * scale).toFixed(3),
});

const styleRows = ({ width, height, font, stroke }, transform) => [
  ["width", `${width}px`],
  ["height", `${height}px`],
  ["fontSize", `${font}px`],
  ["lineHeight", `${height}px`],
  ["--stage-text-stroke", `${stroke}px`],
  ["transform", transform],
  ["opacity", "1"],
];

const writeRows = (style, rows) =>
  rows.forEach(([name, value]) => {
    if (name.startsWith("--")) style.setProperty(name, value);
    else style[name] = value;
  });

// Рисовальщик помнит, что записал в стиль в прошлый раз: те же числа каждый кадр будили бы пересчёт.
const createPainter = (frameRef, placeRef) => {
  let shown = "";
  const hideBox = (box) => {
    if (shown !== HIDDEN) box.style.opacity = "0";
    shown = HIDDEN;
  };

  return () => {
    const box = frameRef.current;
    if (!box) return;
    const place = placeRef.current;
    const points = screenCorners(place);
    if (!points) return hideBox(box);

    const fit = fitToCorners(points, place.layout);
    const transform = rectToQuadCss(fit.width, fit.height, points);
    if (!transform) return hideBox(box);

    const nums = readouts(place.layout, fit);
    const signature = [transform, nums.width, nums.height, nums.font, nums.stroke].join("|");
    if (signature === shown) return;
    shown = signature;
    writeRows(box.style, styleRows(nums, transform));
  };
};

// Один проход сразу (поле стоит на месте, а не в углу), дальше каждый кадр; возвращает отмену.
const runEveryFrame = (paint) => {
  let frame = 0;
  const tick = () => {
    paint();
    frame = requestAnimationFrame(tick);
  };
  paint();
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
};

/* ---------- фокус ---------- */

const focusField = (input, selectAll) => {
  if (!input) return;
  input.focus({ preventScroll: true });
  const end = input.value.length;
  if (selectAll) input.select();
  else input.setSelectionRange?.(end, end);
};

/* ---------- разметка ---------- */

const frameClass = (drawn) => ["stage-text-field", drawn ? "" : "is-caret-only"].filter(Boolean).join(" ");

const frameStyle = (layout, look, drawn) => {
  const fill = look.fill || WHITE;
  return {
    fontWeight: layout?.weight,
    fontStyle: layout?.style,
    "--stage-text-fill": fill,
    "--stage-text-caret": look.caret || fill,
    "--stage-text-outline": look.outline || CLEAR,
    "--stage-text-backdrop": (drawn && look.backdrop) || CLEAR,
    "--stage-text-opacity": clamp(look.opacity ?? 1, [0, 1]),
  };
};

// Обводка под буквами; поверх неё лежит заливка самого поля.
const strokeLayer = (words, family) =>
  h(
    "span",
    {
      className: "stage-text-field-stroke",
      "aria-hidden": "true",
      "data-audit-ignore": "type-min type-scale caps",
      style: { fontFamily: family },
    },
    words,
  );

const finishOnKey = (done) => (event) => {
  if (!FINISH_KEYS.has(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  done?.();
};

const inputAttrs = ({ label, value, maxLength, onChange, onDone }) => ({
  type: "text",
  className: "stage-text-field-input",
  "aria-label": label,
  "data-audit-ignore": "type-min type-scale caps hit-target",
  value,
  maxLength,
  spellCheck: false,
  autoComplete: "off",
  onChange: (event) => onChange?.(event.target.value),
  onBlur: () => onDone?.(),
  onKeyDown: finishOnKey(onDone),
});

/* ---------- компонент ---------- */

function SurfaceTextField({
  corners,
  layout,
  look = {},
  maxLength = 64,
  onChange,
  onDone,
  project,
  select = false,
  value,
}) {
  useTr();
  const frameRef = useRef(null);
  const inputRef = useRef(null);
  const placeRef = useRef({ corners, layout, project });
  placeRef.current = { corners, layout, project };

  const family = layout?.family;
  useLayoutEffect(() => {
    if (!family) return;
    inputRef.current?.style.setProperty("font-family", family, "important");
  }, [family]);

  useLayoutEffect(() => {
    if (!select) {
      focusField(inputRef.current, select);
      return undefined;
    }
    const timer = setTimeout(() => focusField(inputRef.current, select), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const paint = createPainter(frameRef, placeRef);
    return runEveryFrame(paint);
  }, []);

  const drawn = look.drawn !== false;
  const field = h("input", {
    ref: inputRef,
    ...inputAttrs({ label: tr("Слова надписи"), maxLength, onChange, onDone, value }),
  });
  const outline = drawn && look.outline ? strokeLayer(value, family) : null;
  return h(
    "div",
    {
      className: frameClass(drawn),
      onPointerDown: swallow,
      ref: frameRef,
      style: frameStyle(layout, look, drawn),
    },
    outline,
    field,
  );
}

export default SurfaceTextField;
