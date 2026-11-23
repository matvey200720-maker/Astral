import SurfaceTextField from "./SurfaceTextField.jsx";
import { decalBasis } from "@modovik/climb-contract/recolor/decal";
import {
  EMBLEM_OUTLINE_COLOURS,
  emblemCssFont,
  emblemTextLayout,
} from "../emblem/emblem-items.js";
import { EMBLEM_TEXT_LIMIT } from "@modovik/climb-contract/recolor/emblems";
import { createElement as h, useCallback, useMemo, useRef } from "react";

// Знаки обхода рамки: левый верхний, правый верхний, правый нижний, левый нижний.
const CORNER_SIGNS = [
  [-1, 1],
  [1, 1],
  [1, -1],
  [-1, -1],
];

const frameOf = (item, aspect) => {
  const { right, up } = decalBasis(item.normal || [0, 0, 1], item.angle || 0);
  return {
    point: item.point,
    right,
    up,
    halfWidth: (item.size * aspect) / 2,
    halfHeight: item.size / 2,
  };
};

const cornerAt = ({ point, right, up, halfWidth, halfHeight }, [sx, sy]) =>
  Array.from(
    { length: 3 },
    (_, axis) => point[axis] + right[axis] * halfWidth * sx + up[axis] * halfHeight * sy,
  );

const cornersOf = (item, aspect) => {
  const frame = frameOf(item, aspect);
  return CORNER_SIGNS.map((signs) => cornerAt(frame, signs));
};

const cornersFrom = (item, shape) =>
  shape && item.point && item.size ? cornersOf(item, shape.width / shape.height) : null;

const projectVia = (stage, point) => stage?.current?.project?.(point) || null;

const layoutOf = (text) => {
  const shape = emblemTextLayout(text);
  return shape ? Object.assign({}, shape, emblemCssFont(text)) : null;
};

const outlineColour = (outline) => (outline === "none" ? "" : EMBLEM_OUTLINE_COLOURS[outline]);

const lookOf = ({ text, opacity }) => ({
  drawn: true,
  fill: text.colour,
  outline: outlineColour(text.outline),
  backdrop: text.backdrop || "",
  opacity: (opacity ?? 100) / 100,
});

const contentOf = ({ value }) => ({ value, maxLength: EMBLEM_TEXT_LIMIT });

const useLatest = (value) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

// Форма пересчитывается только при смене текста, остальное в расчёте не важно.
const useTextLayout = (text) => {
  const textKey = JSON.stringify(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => layoutOf(text), [textKey]);
};

const StageTextField = (props) => {
  const { onDone, onChange, select = false, item, stage } = props;

  const layout = useTextLayout(item.text);
  const itemRef = useLatest(item);
  const layoutRef = useLatest(layout);

  const project = useCallback((point) => projectVia(stage, point), [stage]);
  const corners = useCallback(
    () => cornersFrom(itemRef.current, layoutRef.current),
    [itemRef, layoutRef],
  );

  const fieldProps = {
    ...contentOf(item.text),
    look: lookOf(item),
    project,
    corners,
    layout,
    select,
    onChange,
    onDone,
  };
  return h(SurfaceTextField, fieldProps);
};

export default StageTextField;
