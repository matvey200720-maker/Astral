// Пространство сцены: кадр из памяти, холст с запасом, проекция, единица сцены, допуски.
// Окно (useStageWindow) живёт в stage-window.js, перевод точек - в stage-lens.js.
import { FALLBACK_WIDTH, POINTS } from "./numbers.js";
import { useLens } from "./stage-lens.js";
import { canvasBoxOf, canvasFrameOf, clampZoom, isPannable } from "./frame-math.js";
import { useMapMemory } from "../world-map-memory.js";
import { resolveFrame } from "../world-map-frame.js";
import { createProjector } from "@modovik/vector-map";
import { useMemo } from "react";

export { useStageWindow } from "./stage-window.js";

const VIEW_FIELDS = ["x", "y", "zoom"];
const START_VIEW = { x: 0, y: 0, zoom: 1 };

// Память кадра: только конечные числа, зум зажат
function restoreView(stored) {
  const values = VIEW_FIELDS.map((field) => stored?.[field]);
  if (!values.every((value) => Number.isFinite(value))) return undefined;
  const [x, y, zoom] = values;
  return { x, y, zoom: clampZoom(zoom) };
}

// Кадр и холст с запасом вокруг него
function withCanvas(frame) {
  const canvas = canvasFrameOf(frame);
  return { frame, canvas };
}

// Единица сцены на точку экрана и метры мира на точку; допуски считаются от них
class Scale {
  constructor(frame, win, projector) {
    this.unit = frame.width / (win.width || FALLBACK_WIDTH);
    this.metersPerDot = this.unit / (projector.length(1000) / 1000 || 1);
  }

  // Допуски: что считается от точек экрана (метры мира) и что от единицы сцены
  tolerances() {
    const { hit, close, handle, handleGap } = POINTS;
    const { unit, metersPerDot } = this;
    return {
      tolerance: hit * metersPerDot,
      closeTolerance: close * metersPerDot,
      handleSize: handle * unit,
      handleGap: handleGap * unit,
    };
  }
}

// Производное значение: make(input) пересчитывается, только когда сменился input
const useMade = (make, input) => useMemo(() => make(input), [make, input]);

// Все хуки геометрии подряд: память кадра, холст, проекция, рамка холста, перевод точек
function useGeometryParts(inputs) {
  const { memoryId, scene, atlas, svgRef, win } = inputs;
  const remembered = useMapMemory(memoryId, "view", { ...START_VIEW }, restoreView);
  const [view, setView] = remembered;
  const shown = useMemo(() => withCanvas(resolveFrame(view, scene, win)), [view, scene, win]);
  const projector = useMade(createProjector, atlas);
  const box = useMade(canvasBoxOf, win);
  const lens = useLens({ canvas: shown.canvas, scene, atlas, svgRef });
  return { view, setView, shown, projector, box, lens };
}

export function useStageGeometry(inputs) {
  const { view, setView, shown, projector, box, lens } = useGeometryParts(inputs);
  const scale = new Scale(shown.frame, inputs.win, projector);
  return {
    view,
    setView,
    frame: shown.frame,
    canvas: shown.canvas,
    unit: scale.unit,
    metersPerDot: scale.metersPerDot,
    ...scale.tolerances(),
    ...lens,
    box,
    projector,
    pannable: isPannable(inputs.scene, shown.frame),
  };
}
