// Свойства сцены с умолчаниями и «окружение» обработчиков указателя: свежие свойства, геометрия,
// камера и сеттеры состояния, собранные на каждую отрисовку.
const NO_PICKED = [];

// Умолчания действуют только для undefined (как у значений параметров функции)
const DEFAULTS = {
  shape: "free",
  shapeLook: null,
  preferLayer: null,
  picked: NO_PICKED,
  onSelectMany: null,
  onShape: null,
  onErase: null,
  eraserSize: 160,
  brush: null,
  brushMode: "free",
  onStroke: null,
  onZoomChange: null,
  onViewChange: null,
  onDropFiles: null,
  busy: false,
  onObjectMenu: null,
  gamePreview: true,
  onGamePreview: null,
  crowding: null,
  onFixCrowding: null,
  zoomCommand: null,
  textEdit: null,
  onEditText: null,
  meshPick: null,
  onMeshPick: null,
  majesticPick: null,
  onMajesticPick: null,
  boardRow: -1,
  onBoardRow: null,
  onBoardAdd: null,
  onBoardIcon: null,
  backdrop: "",
  className: "",
  overlay: null,
  memoryId: "",
};

export function withDefaults(props) {
  const filled = { ...props };
  Object.entries(DEFAULTS).forEach(([name, value]) => {
    if (props[name] === undefined) filled[name] = value;
  });
  return filled;
}

// Свойства, которые читают правила нажатия и режимы перетаскивания
const FROM_PROPS = [
  "config", "scene", "tool", "shape", "shapeLook", "preferLayer", "selection", "picked", "draft",
  "brush", "brushMode", "eraserSize", "textEdit", "onSelect", "onSelectMany", "onDraftPoint",
  "onPlace", "onShape", "onErase", "onStroke", "onObjectMenu", "onMeshPick", "onMajesticPick",
  "onBoardRow", "onBoardAdd", "onBoardIcon", "onEditText", "onDropFiles",
];
const FROM_GEOMETRY = [
  "frame", "projector", "unit", "metersPerDot", "tolerance", "closeTolerance", "handleSize",
  "handleGap", "sceneAt", "toWorld", "worldAt",
];
const FROM_POINTER = [
  "dragRef", "pressRef", "nodes", "setDragging", "setMarquee", "setStretch", "setAim", "setWet",
  "setTrail", "setCursor",
];

const take = (source, names) => Object.fromEntries(names.map((name) => [name, source[name]]));

export function buildEnv({ props, geo, camera, pointer, win, stageRef, textAdvance }) {
  return {
    ...take(props, FROM_PROPS),
    ...take(geo, FROM_GEOMETRY),
    ...take(pointer, FROM_POINTER),
    win,
    stageRef,
    textAdvance,
    ctl: camera.ctl,
    spaceRef: camera.spaceRef,
    change: (next, label, key) => props.onConfigChange(next, label, key),
  };
}

// Классы слоя-мишени: инструмент, фигура «Зон», перетаскивание, пробел или курсор ручек
export function hitClassOf({ tool, shape, dragging, space, cursor }) {
  const parts = [`tool-${tool}`];
  if (tool === "zones") parts.push(shape === "free" ? "shape-free" : "shape-box");
  if (dragging) parts.push("is-dragging");
  parts.push(...(space ? ["is-space"] : cursor ? [`handle-${cursor}`] : []));
  return parts.join(" ");
}
