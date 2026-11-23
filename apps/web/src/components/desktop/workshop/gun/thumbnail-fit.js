import * as THREE from "three";

const byDescending = (a, b) => b - a;
const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const halfwayOf = (lo, hi) => (lo + hi) / 2;
const dimsOf = (canvas) => [canvas.width, canvas.height];

/* Вытянутость: длинная сторона к средней. Сортировка обычная, чтобы NaN и undefined вели себя как у массива. */
const elongation = (size) => {
  const { x, y, z } = size;
  const [longest, middle] = [x, y, z].sort(byDescending);
  return longest / Math.max(middle, MIN_SIDE);
};

/* Ось длинной стороны: первое сработавшее правило, иначе z. */
function longestAxis(size) {
  const hit = AXIS_RULES.find(([, holds]) => holds(size));
  return hit ? hit[0] : "z";
}

/* Вытянутую модель показываем с торца: вдоль оси, сбоку и чуть сверху. */
function endOnDirection(size) {
  const [alongAxis, upAxis] = AXIS_FRAMES[longestAxis(size)];
  const along = vec(...alongAxis);
  const up = vec(...upAxis);
  const side = vec(0, 0, 0).crossVectors(along, up).normalize();
  const terms = [
    [along, ALONG_WEIGHT],
    [side, SIDE_WEIGHT],
    [up, UP_WEIGHT],
  ];
  return terms.reduce((sum, [axis, weight]) => sum.addScaledVector(axis, weight), vec(0, 0, 0)).normalize();
}

const viewDirection = (size) => (elongation(size) < ELONGATED ? vec(...GLANCE).normalize() : endOnDirection(size));

/* Угол рамки по номеру 0..7: старший бит выбирает x, средний y, младший z. */
function* cornersOf({ min, max }) {
  for (let index = 0; index < 8; index += 1) {
    yield vec(index & 4 ? max.x : min.x, index & 2 ? max.y : min.y, index & 1 ? max.z : min.z);
  }
}

const projectedBounds = (box, camera) => {
  camera.updateMatrixWorld(true);
  const xs = [];
  const ys = [];
  for (const corner of cornersOf(box)) {
    const { x, y } = corner.project(camera);
    xs.push(x);
    ys.push(y);
  }
  return Object.fromEntries([
    ["minX", Math.min(...xs)],
    ["maxX", Math.max(...xs)],
    ["minY", Math.min(...ys)],
    ["maxY", Math.max(...ys)],
  ]);
};

/* Оси кадра в мире: столбцы мировой матрицы камеры. */
const frameAxis = (camera, column) => vec(0, 0, 0).setFromMatrixColumn(camera.matrixWorld, column);

/* Камера смотрит из точки direction * distance в начало координат. */
function cameraAt(direction, distance, radius) {
  const camera = new THREE.PerspectiveCamera(SHOT_FOV, 1, radius / 50, radius * 50);
  const eye = direction.clone().multiplyScalar(distance);
  camera.position.copy(eye);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

/* Смещение модели вдоль осей кадра, при котором проекция встаёт в середину. */
function centeringShift(box, camera, halfHeight) {
  const { minX, maxX, minY, maxY } = projectedBounds(box, camera);
  const pull = [halfwayOf(minX, maxX), halfwayOf(minY, maxY)];
  return pull.reduce(
    (shift, centre, column) => shift.addScaledVector(frameAxis(camera, column), -centre * halfHeight),
    vec(0, 0, 0),
  );
}

const widest = ({ minX, maxX, minY, maxY }) => Math.max(maxX - minX, maxY - minY, MIN_SPAN);

const fitCamera = (box, { pad = SHOT_PAD } = {}) => {
  const size = box.getSize(vec(0, 0, 0));
  const radius = Math.max(MIN_RADIUS, size.length() / 2);
  const direction = viewDirection(size);
  const halfFov = THREE.MathUtils.degToRad(SHOT_FOV / 2);
  const distance = DISTANCE_SLACK * (radius / Math.sin(halfFov));

  const camera = cameraAt(direction, distance, radius);
  const shift = centeringShift(box, camera, Math.tan(halfFov) * distance);
  const moved = box.clone();
  moved.translate(shift);

  const room = 1 - 2 * pad;
  camera.zoom = (2 * room) / widest(projectedBounds(moved, camera));
  camera.updateProjectionMatrix();

  return { camera, shift, bounds: projectedBounds(moved, camera), direction };
};

const widen = (range, at) => {
  if (at < range.lo) range.lo = at;
  if (at > range.hi) range.hi = at;
};

function contentBounds(data, width, height, edge = ALPHA_EDGE) {
  const opaque = (x, y) => !(data[(y * width + x) * 4 + 3] <= edge);
  const cols = { lo: Infinity, hi: -Infinity };
  const rows = { lo: Infinity, hi: -Infinity };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!opaque(x, y)) continue;
      widen(cols, x);
      widen(rows, y);
    }
  }
  if (cols.lo > cols.hi) return null;
  return { left: cols.lo, top: rows.lo, right: cols.hi + 1, bottom: rows.hi + 1 };
}

const composeRect = (bounds, width, height = width, pad = FRAME_PAD) => {
  const inner = 1 - 2 * pad;
  const sx = bounds.left;
  const sy = bounds.top;
  const sw = bounds.right - sx;
  const sh = bounds.bottom - sy;
  const fits = [
    [width, sw],
    [height, sh],
  ].map(([room, body]) => (room * inner) / body);
  const scale = Math.min(...fits, MAX_UPSCALE);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  return { sx, sy, sw, sh, dx, dy, dw, dh };
};

const touchesEdge = (bounds, width, height, margin = 1) => {
  const { left, top, right, bottom } = bounds;
  return [left <= margin, top <= margin, right >= width - margin, bottom >= height - margin].some(Boolean);
};

/* Холст нужного размера; размеры читаются уже после createElement. */
const newCanvas = (dims) =>
  Object.assign(document.createElement("canvas"), { width: dims.width, height: dims.height });

const asIs = (source) => ({ canvas: source, clipped: false });

function trimmedFrame(source, width = ICON_WIDTH, height = ICON_HEIGHT, pad = FRAME_PAD) {
  const probe = newCanvas(source);
  const reader = probe.getContext("2d", PROBE_OPTIONS);
  if (!reader) return asIs(source);

  reader.drawImage(source, 0, 0);
  const { data } = reader.getImageData(0, 0, ...dimsOf(probe));
  const bounds = contentBounds(data, ...dimsOf(probe));
  if (!bounds) return asIs(source);

  const target = newCanvas({ width, height });
  const painter = target.getContext("2d");
  if (!painter) return asIs(source);

  painter.imageSmoothingQuality = "high";
  /* Значения composeRect идут в порядке аргументов drawImage: sx, sy, sw, sh, dx, dy, dw, dh. */
  painter.drawImage(probe, ...Object.values(composeRect(bounds, width, height, pad)));
  const clipped = touchesEdge(bounds, ...dimsOf(probe));
  return { canvas: target, clipped };
}

/* Взгляд невытянутой модели: сбоку-спереди. */
const GLANCE = [0.35, 0.22, 1.05];

/* Для вытянутой модели: [вдоль, вверх]; вдоль оси y «вверх» уходит на z. */
const AXIS_FRAMES = {
  x: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  y: [
    [0, 1, 0],
    [0, 0, 1],
  ],
  z: [
    [0, 0, 1],
    [0, 1, 0],
  ],
};

/* При равенстве побеждает ось с меньшим номером; сравнения с NaN ложны. */
const AXIS_RULES = [
  ["x", ({ x, y, z }) => x >= y && x >= z],
  ["y", ({ y, z }) => y >= z],
];

const PROBE_OPTIONS = { willReadFrequently: true };

const ALONG_WEIGHT = 0.62;
const SIDE_WEIGHT = 0.78;
const UP_WEIGHT = 0.34;
const SHOT_FOV = 32;
const DISTANCE_SLACK = 1.04;
const MIN_SIDE = 1e-6;
const MIN_SPAN = 1e-6;
const MIN_RADIUS = 0.01;
const ALPHA_EDGE = 12;
const MAX_UPSCALE = 3;

const ELONGATED = 2.4;
const FRAME_PAD = 0.1;
const SHOT_PAD = 0.04;
const ICON_WIDTH = 320;
const ICON_HEIGHT = 160;

export {
  ELONGATED,
  FRAME_PAD,
  ICON_HEIGHT,
  ICON_WIDTH,
  SHOT_PAD,
  composeRect,
  contentBounds,
  elongation,
  fitCamera,
  projectedBounds,
  touchesEdge,
  trimmedFrame,
  viewDirection,
};
