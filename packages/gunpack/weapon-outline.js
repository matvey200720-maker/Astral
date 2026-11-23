// Плоский силуэт ствола: растр треугольников → контуры квадратов 2×2 → упрощение → путь SVG и точки деталей.

export const WEAPON_OUTLINE_VERSION = 1;

const DEGENERATE_TRIANGLE = 1e-9;
const SMALLEST_CONTOUR_AREA = 4;
const SHORTEST_SIMPLIFIED = 8;

const roundTenth = (value) => Math.round(value * 10) / 10;

const isUsableMesh = (mesh) => Boolean(mesh)
  && mesh.positions?.length >= 9
  && mesh.indices?.length >= 3
  && !mesh.invertedHull;

// --- Границы и перевод координат.

function modelBounds(meshes) {
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const { positions } of meshes) {
    for (let at = 0; at < positions.length; at += 3) {
      const x = positions[at];
      const y = positions[at + 1];
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < bottom) bottom = y;
      if (y > top) top = y;
    }
  }
  const spanX = right - left;
  const spanY = top - bottom;
  return spanX > 0 && spanY > 0 ? { left, top, spanX, spanY } : null;
}

class ImageMapping {
  constructor({ left, top, spanX, spanY }, width, pad) {
    this.left = left;
    this.top = top;
    this.pad = pad;
    this.scale = (width - 2 * pad) / spanX;
    this.height = Math.ceil(spanY * this.scale) + 2 * pad;
  }

  x(value) {
    return (value - this.left) * this.scale + this.pad;
  }

  y(value) {
    return (this.top - value) * this.scale + this.pad;
  }

  spot(x, y) {
    return [roundTenth(this.x(x)), roundTenth(this.y(y))];
  }
}

// --- Растр.

function fillTriangle(cells, width, height, ax, ay, bx, by, cx, cy) {
  const doubledArea = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  // Условие записано так, чтобы NaN в координатах тоже отсекался.
  if (!(Math.abs(doubledArea) >= DEGENERATE_TRIANGLE)) return;
  const rowFrom = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5));
  const rowTo = Math.ceil(Math.max(ay, by, cy) - 0.5);
  const colFrom = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5));
  const colTo = Math.ceil(Math.max(ax, bx, cx) - 0.5);
  for (let row = rowFrom; row <= rowTo && row < height; row += 1) {
    const py = row + 0.5;
    for (let col = colFrom; col <= colTo && col < width; col += 1) {
      const px = col + 0.5;
      const ab = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      const bc = (cx - bx) * (py - by) - (cy - by) * (px - bx);
      const ca = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
      if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) {
        cells[row * width + col] = 1;
      }
    }
  }
}

function rasterize(meshes, mapping, width, height) {
  const cells = new Uint8Array(width * height);
  for (const { positions, indices } of meshes) {
    const x = (index) => mapping.x(positions[index * 3]);
    const y = (index) => mapping.y(positions[index * 3 + 1]);
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]];
      fillTriangle(cells, width, height, x(a), y(a), x(b), y(b), x(c), y(c));
    }
  }
  return cells;
}

// --- Контуры. Отрезки квадрата 2×2 от его центра; закрашенное справа по ходу, ось Y вниз.

const TOP = [0, -0.5];
const RIGHT = [0.5, 0];
const BOTTOM = [0, 0.5];
const LEFT = [-0.5, 0];

// Номер: 1 левая верхняя, 2 правая верхняя, 4 правая нижняя, 8 левая нижняя клетка.
const SQUARE_SEGMENTS = [
  [],
  [[TOP, LEFT]],
  [[RIGHT, TOP]],
  [[RIGHT, LEFT]],
  [[BOTTOM, RIGHT]],
  [[TOP, LEFT], [BOTTOM, RIGHT]],
  [[BOTTOM, TOP]],
  [[BOTTOM, LEFT]],
  [[LEFT, BOTTOM]],
  [[TOP, BOTTOM]],
  [[RIGHT, TOP], [LEFT, BOTTOM]],
  [[RIGHT, BOTTOM]],
  [[LEFT, RIGHT]],
  [[TOP, RIGHT]],
  [[LEFT, TOP]],
  [],
];

// Выше 65 535 клеток разные точки получают одно число, и последний отрезок с таким началом вытесняет прежний.
const pointKey = (x, y) => (2 * x + 2) * 65536 + (2 * y + 2);

function traceSegments(cells, width, height) {
  // Чтение мимо ряда (дробная ширина) даёт undefined, номер квадрата становится NaN, и отрезков у него нет.
  const cell = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : cells[y * width + x]);
  const endX = [];
  const endY = [];
  const startingAt = new Map();
  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      const code = cell(x, y) + 2 * cell(x + 1, y) + 4 * cell(x + 1, y + 1) + 8 * cell(x, y + 1);
      const segments = SQUARE_SEGMENTS[code];
      if (!segments || segments.length === 0) continue;
      for (const [from, to] of segments) {
        startingAt.set(pointKey(x + 1 + from[0], y + 1 + from[1]), endX.length);
        endX.push(x + 1 + to[0]);
        endY.push(y + 1 + to[1]);
      }
    }
  }
  return { endX, endY, startingAt };
}

function walkContours({ endX, endY, startingAt }) {
  const walked = new Uint8Array(endX.length);
  const contours = [];
  for (let first = 0; first < endX.length; first += 1) {
    if (walked[first]) continue;
    const xs = [];
    const ys = [];
    let segment = first;
    while (segment !== undefined && !walked[segment]) {
      walked[segment] = 1;
      xs.push(endX[segment]);
      ys.push(endY[segment]);
      segment = startingAt.get(pointKey(endX[segment], endY[segment]));
    }
    contours.push({ xs, ys });
  }
  return contours;
}

// --- Упрощение.

function farthestFromFirst({ xs, ys }) {
  let farthest = 1;
  let longest = -1;
  for (let i = 1; i < xs.length; i += 1) {
    const dx = xs[i] - xs[0];
    const dy = ys[i] - ys[0];
    const squared = dx * dx + dy * dy;
    if (squared > longest) {
      longest = squared;
      farthest = i;
    }
  }
  return farthest;
}

// Дуглас — Пекер на явном стеке; xs и ys замкнуты первой точкой в конце.
function markKeptPoints(xs, ys, keep, chords, tolerance) {
  while (chords.length > 0) {
    const to = chords.pop();
    const from = chords.pop();
    const dx = xs[to] - xs[from];
    const dy = ys[to] - ys[from];
    const chord = Math.sqrt(dx * dx + dy * dy) || 1;
    let widest = -1;
    let split = -1;
    for (let i = from + 1; i < to; i += 1) {
      const distance = Math.abs((xs[i] - xs[from]) * dy - (ys[i] - ys[from]) * dx) / chord;
      if (distance > widest) {
        widest = distance;
        split = i;
      }
    }
    if (widest > tolerance) {
      // Допуск ниже −1 не проверяется заранее и отказывает на хорде без внутренних точек.
      if (split < 0) throw new TypeError("Outline tolerance is below -1.");
      keep[split] = 1;
      chords.push(from, split, split, to);
    }
  }
}

function simplifyContour(contour, tolerance) {
  const count = contour.xs.length;
  if (count < SHORTEST_SIMPLIFIED) return contour;
  const farthest = farthestFromFirst(contour);
  const xs = [...contour.xs, contour.xs[0]];
  const ys = [...contour.ys, contour.ys[0]];
  const keep = new Uint8Array(count + 1);
  keep[0] = 1;
  keep[farthest] = 1;
  markKeptPoints(xs, ys, keep, [0, farthest, farthest, count], tolerance);
  return {
    xs: contour.xs.filter((_, i) => keep[i]),
    ys: contour.ys.filter((_, i) => keep[i]),
  };
}

function contourArea({ xs, ys }) {
  let doubled = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const next = (i + 1) % xs.length;
    doubled += xs[i] * ys[next] - xs[next] * ys[i];
  }
  return Math.abs(doubled) / 2;
}

function contourPath({ xs, ys }) {
  const points = xs.map((x, i) => `${roundTenth(x)} ${roundTenth(ys[i])}`);
  return `M${points.join("L")}Z`;
}

// --- Точки крепления.

function partFrames(meshes) {
  const frames = Object.create(null);
  for (const mesh of meshes) {
    const name = mesh.part?.bone || mesh.mount;
    if (!name) continue;
    const frame = (frames[name] ??= { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const { positions } = mesh;
    for (let at = 0; at < positions.length; at += 3) {
      // Здесь NaN заражает рамку, в отличие от границ модели.
      frame.minX = Math.min(frame.minX, positions[at]);
      frame.maxX = Math.max(frame.maxX, positions[at]);
      if (at + 1 < positions.length) {
        frame.minY = Math.min(frame.minY, positions[at + 1]);
        frame.maxY = Math.max(frame.maxY, positions[at + 1]);
      }
    }
  }
  return frames;
}

function collectSpots(bones, meshes, mapping) {
  const spots = {};
  for (const bone of bones || []) {
    if (bone?.name && bone.matrix) spots[bone.name] = mapping.spot(bone.matrix[12], bone.matrix[14]);
  }
  const frames = partFrames(meshes);
  for (const name of Object.keys(frames)) {
    const { minX, maxX, minY, maxY } = frames[name];
    spots[name] = mapping.spot((minX + maxX) / 2, (minY + maxY) / 2);
  }
  return spots;
}

export function weaponOutline(model, { size = 1024, tolerance = 0.9, pad = 4 } = {}) {
  const meshes = model?.meshes;
  if (!meshes) return null;
  const usable = meshes.filter(isUsableMesh);
  const bounds = modelBounds(usable);
  if (!bounds) return null;

  const width = Number(size);
  const mapping = new ImageMapping(bounds, width, Number(pad));
  const { height } = mapping;
  const cells = rasterize(usable, mapping, width, height);
  const contours = walkContours(traceSegments(cells, width, height))
    .map((contour) => simplifyContour(contour, tolerance))
    .filter((contour) => contour.xs.length >= 3 && contourArea(contour) >= SMALLEST_CONTOUR_AREA);
  if (contours.length === 0) return null;

  return {
    version: WEAPON_OUTLINE_VERSION,
    width: size,
    height,
    path: contours.map(contourPath).join(""),
    spots: collectSpots(model.bones, usable, mapping),
  };
}
