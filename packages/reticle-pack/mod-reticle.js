import {
  IDENTITY,
  TAG,
  displayList,
  multiply,
  readGfx,
  readShape,
  spritesWithLabels,
} from "@modovik/gfx";
import {
  normalizeOrdinaryReticle,
  ordinaryReticleLayers,
  regionContours,
  rgbToHex,
} from "@modovik/reticle-contract";
import { customLockOn, enemyColour, readReticleScript } from "./mod-script.js";

// Все длины — в твипах (20 на точку сцены).
const UNIT = Object.freeze({ twips: 20, curveParts: 12, nestDepth: 12 });
const TOLERANCE = Object.freeze({
  join: 0.25,
  repeat: 0.01,
  straightArea: 0.01,
  position: 1,
  diamondAxis: 0.5,
  circleSpread: 0.08,
});
const RASTER = Object.freeze({ pad: 4, minStep: 2.5, maxCells: 4e6, areaShare: 0.002, curveBand: 1.2 });
const PLAIN_COLOUR = [255, 255, 255];
const PLAIN_OUTLINE = [16, 20, 25];

const MAIN_LABEL = "WEAPONTYPE_RIFLE";
const GUN_FRAMES = [
  [MAIN_LABEL, "винтовок"],
  ["WEAPON_PISTOL", "пистолетов"],
  ["WEAPONTYPE_SMG", "пистолетов-пулемётов"],
  ["WEAPONTYPE_SHOTGUN", "дробовиков"],
];

const LOST = {
  scope: "оптика снайперских винтовок — из редактора, не автора",
  skipped: "маски, картинки или линии в прицеле автора — редактор рисует только фигуры",
  otherColours: "части прицела своими цветами — в редакторе цвет один",
  outlineApprox: "обводка прицела — приблизительно: в редакторе она одна на все фигуры",
  outlineMissing: "у прицела автора нет обводки там, где её рисует редактор",
  noCode: "код прицела автора не прочитан — цвет взят с рисунка",
  noColour: "цвет автора в его коде не найден — взят цвет рисунка",
  alwaysVisible: "игра у автора не прячет прицел — такой видимости в редакторе нет",
  ownLockOn: "свои цвета прицела на союзнике и при захвате цели",
};

// ------------------------------------------------------------------ мелкие помощники

const distance = ([ax, ay], [bx, by]) => Math.hypot(ax - bx, ay - by);
const place = (m, x, y) => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty];
const clampByte = (value) => Math.min(255, Math.max(0, value));
const within = (a, b, eps) => Math.abs(a - b) <= eps;

function bucketBy(items, keyOf) {
  const buckets = new Map();
  for (const item of items) {
    const key = keyOf(item);
    (buckets.get(key) ?? buckets.set(key, []).get(key)).push(item);
  }
  return buckets;
}

function firstOf(iterable, accept) {
  for (const item of iterable) if (accept(item)) return item;
  return null;
}

// Рамка набора точек или null, если точек нет.
function extentOf(points) {
  let box = null;
  for (const [x, y] of points) {
    box = box
      ? { minX: Math.min(box.minX, x), maxX: Math.max(box.maxX, x), minY: Math.min(box.minY, y), maxY: Math.max(box.maxY, y) }
      : { minX: x, maxX: x, minY: y, maxY: y };
  }
  return box;
}

const sumCurves = (regions) => regions.reduce((total, region) => total + region.curves, 0);
const segmentsOf = (regions) => regions.map((region) => region.segments);

// ------------------------------------------------------------------ сбор областей кадра

const NO_TINT = { mult: [1, 1, 1, 1], add: [0, 0, 0, 0] };

// Сначала действует преобразование вложенного размещения, потом внешнее.
function composeTint(outer, inner) {
  if (!inner || !inner.mult || !inner.add) return outer;
  return {
    mult: outer.mult.map((m, i) => m * inner.mult[i]),
    add: outer.add.map((a, i) => inner.add[i] * outer.mult[i] + a),
  };
}

// Куски ребра в твипах сцены: [от, до, из кривой ли]; кривая режется на отрезки.
function* edgePieces(edge, matrix) {
  const start = place(matrix, edge.x0, edge.y0);
  const end = place(matrix, edge.x1, edge.y1);
  if (edge.cx == null) {
    yield [start, end, false];
    return;
  }
  const control = place(matrix, edge.cx, edge.cy);
  const onCurve = (t) => {
    const u = 1 - t;
    return [0, 1].map((axis) => u * u * start[axis] + 2 * u * t * control[axis] + t * t * end[axis]);
  };
  let from = start;
  for (let part = 1; part <= UNIT.curveParts; part++) {
    const to = onCurve(part / UNIT.curveParts);
    yield [from, to, true];
    from = to;
  }
}

function fillBoundary(edges, fillIndex, matrix) {
  const pieces = edges
    .filter((edge) => edge.fill0 !== edge.fill1 && (edge.fill0 === fillIndex || edge.fill1 === fillIndex))
    .flatMap((edge) => [...edgePieces(edge, matrix)])
    .filter(([from, to]) => from[0] !== to[0] || from[1] !== to[1]);
  return {
    segments: pieces.map(([from, to]) => [from[0], from[1], to[0], to[1]]),
    curves: pieces.filter(([, , curved]) => curved).reduce((total, [from, to]) => total + distance(from, to), 0),
  };
}

// Размещения-фигуры кадра; пропущенное считается в tally.skipped.
function* placedShapes(gfx, spriteId, frame, tally, matrix, tint, depth) {
  for (const placed of displayList(gfx, spriteId, frame)) {
    if (depth === 0 && placed.name === "hitmarker") continue;
    if (placed.visible === false) continue;
    const definition = placed.clipDepth == null ? gfx.definitions.get(placed.characterId) : null;
    if (!definition) {
      tally.skipped++;
      continue;
    }
    const at = multiply(matrix, placed.matrix ?? IDENTITY);
    const tinted = composeTint(tint, placed.cxform);
    if (definition.code !== TAG.DEFINE_SPRITE) yield { definition, at, tinted };
    else if (depth + 1 < UNIT.nestDepth) yield* placedShapes(gfx, placed.characterId, 0, tally, at, tinted, depth + 1);
  }
}

function regionsOfShape(gfx, { definition, at, tinted }, tally) {
  let shape;
  try {
    shape = readShape(gfx.bytes, definition);
  } catch {
    tally.skipped++;
    return [];
  }
  if (shape.edges.some((edge) => edge.line >= 0)) tally.skipped++;
  return shape.fills.flatMap((fill, index) => {
    if (fill.type !== "solid") {
      tally.skipped++;
      return [];
    }
    const color = fill.color.map((channel, i) => clampByte(channel * tinted.mult[i] + tinted.add[i]));
    if (color[3] <= 0) return [];
    const { segments, curves } = fillBoundary(shape.edges, index, at);
    return segments.length > 0 ? [{ color, segments, curves }] : [];
  });
}

function scanFrame(gfx, sprite, frame) {
  const tally = { skipped: 0 };
  const regions = [];
  for (const shape of placedShapes(gfx, sprite, frame, tally, IDENTITY, NO_TINT, 0)) {
    regions.push(...regionsOfShape(gfx, shape, tally));
  }
  return { regions, skipped: tally.skipped };
}

// ------------------------------------------------------------------ цветовые группы

const brightness = ([r, g, b, alpha]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha;

function groupByColour(regions) {
  const buckets = bucketBy(regions, (region) => region.color.map(Math.round).join(","));
  return [...buckets.values()]
    .map((members) => ({ color: members[0].color, regions: members, curves: sumCurves(members) }))
    .sort((a, b) => brightness(b.color) - brightness(a.color));
}

// ------------------------------------------------------------------ контуры

// Поиск концов отрезков по близости: ячейки сетки размером с допуск склейки.
function endpointLookup(segments) {
  const cellOf = (x, y) => [Math.floor(x / TOLERANCE.join), Math.floor(y / TOLERANCE.join)];
  const cells = new Map();
  segments.forEach((segment, id) => {
    for (const end of [0, 1]) {
      const key = cellOf(segment[end * 2], segment[end * 2 + 1]).join(":");
      (cells.get(key) ?? cells.set(key, []).get(key)).push({ id, end });
    }
  });
  return function* around(x, y) {
    const [cx, cy] = cellOf(x, y);
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        for (const entry of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const at = entry.end * 2;
          const segment = segments[entry.id];
          if (Math.hypot(segment[at] - x, segment[at + 1] - y) <= TOLERANCE.join) yield entry;
        }
      }
    }
  };
}

// Одна ломаная: от конца выбранного отрезка к ближайшему свободному, пока не замкнётся.
function growChain(segments, first, around, free) {
  const [x0, y0, x1, y1] = segments[first];
  const points = [[x0, y0], [x1, y1]];
  for (;;) {
    const here = points[points.length - 1];
    if (distance(here, points[0]) <= TOLERANCE.join) {
      points.pop();
      return { points, closed: true };
    }
    const next = firstOf(around(here[0], here[1]), (entry) => free.has(entry.id));
    if (next === null) return { points, closed: false };
    free.delete(next.id);
    const far = (1 - next.end) * 2;
    points.push([segments[next.id][far], segments[next.id][far + 1]]);
  }
}

function stitch(segments) {
  const around = endpointLookup(segments);
  const free = new Set(segments.keys());
  const chains = [];
  while (free.size > 0) {
    const first = free.values().next().value;
    free.delete(first);
    chains.push(growChain(segments, first, around, free));
  }
  return chains;
}

const triangleArea = (a, b, c) =>
  Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

function withoutRepeats(points, closed) {
  const kept = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) >= TOLERANCE.repeat);
  while (closed && kept.length > 1 && distance(kept[0], kept[kept.length - 1]) < TOLERANCE.repeat) kept.pop();
  return kept;
}

// Один проход по точкам: убирает вершины на прямой; сообщает, менялось ли что-то.
function straightenOnce(points, closed) {
  let removed = false;
  for (let i = 0; i < points.length && points.length >= 3; i++) {
    if (!closed && (i === 0 || i === points.length - 1)) continue;
    const before = points[(i + points.length - 1) % points.length];
    const after = points[(i + 1) % points.length];
    if (triangleArea(before, points[i], after) < TOLERANCE.straightArea) {
      points.splice(i--, 1);
      removed = true;
    }
  }
  return removed;
}

function tidy({ points, closed }) {
  const kept = withoutRepeats(points, closed);
  while (kept.length >= 3 && straightenOnce(kept, closed)) {
    // проход повторяется, пока что-то убирается
  }
  return kept.length >= 3 ? { points: kept, closed } : null;
}

// ------------------------------------------------------------------ типы контуров

function boxOf(points) {
  const { minX, maxX, minY, maxY } = extentOf(points);
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function isRectangle(points) {
  return (
    points.length === 4 &&
    points.every((p, i) => {
      const q = points[(i + 1) % 4];
      return within(p[0], q[0], TOLERANCE.repeat) || within(p[1], q[1], TOLERANCE.repeat);
    })
  );
}

function isDiamond(points, box) {
  const onAxis = (p) => within(p[0], box.cx, TOLERANCE.diamondAxis) || within(p[1], box.cy, TOLERANCE.diamondAxis);
  return points.length === 4 && points.every(onAxis);
}

// Круг: от центра рамки до точек почти одно расстояние; радиус — середина разброса.
function circleRadius(points, box) {
  if (points.length < 8) return null;
  const away = points.map((p) => distance(p, [box.cx, box.cy]));
  const low = away.reduce((a, b) => Math.min(a, b));
  const high = away.reduce((a, b) => Math.max(a, b));
  const radius = (low + high) / 2;
  return high - low <= Math.max(1, TOLERANCE.circleSpread * radius) ? radius : null;
}

function describeContour({ points, closed }) {
  const box = boxOf(points);
  if (!closed) return { ...box, kind: "other" };
  if (isRectangle(points)) return { ...box, kind: "rect" };
  if (isDiamond(points, box)) return { ...box, kind: "diamond" };
  const radius = circleRadius(points, box);
  return radius === null ? { ...box, kind: "other" } : { ...box, kind: "circle", r: radius };
}

const strictlyInside = (inner, outer) =>
  inner.minX > outer.minX && inner.maxX < outer.maxX && inner.minY > outer.minY && inner.maxY < outer.maxY;

function boreHole(outer, hole) {
  const concentric = within(outer.cx, hole.cx, TOLERANCE.position) && within(outer.cy, hole.cy, TOLERANCE.position);
  return outer.kind === "circle" && hole.kind === "circle" && concentric
    ? { ...outer, kind: "ring", outer: outer.r, inner: hole.r }
    : { ...outer, kind: "other" };
}

// Контур, внутри рамки которого лежит свободный контур, забирает его как дыру.
function pairHoles(sorted) {
  const claimed = new Set();
  return sorted.flatMap((outer, i) => {
    if (claimed.has(i)) return [];
    const holeAt = sorted.findIndex((candidate, k) => k > i && !claimed.has(k) && strictlyInside(candidate, outer));
    if (holeAt < 0) return [outer];
    claimed.add(holeAt);
    return [boreHole(outer, sorted[holeAt])];
  });
}

function figuresOf(group) {
  const contours = group.regions
    .flatMap((region) => stitch(region.segments))
    .map(tidy)
    .filter(Boolean)
    .map(describeContour)
    .sort((a, b) => b.w * b.h - a.w * a.h);
  return pairHoles(contours);
}

// ------------------------------------------------------------------ обводка

function growthBetween(figure, inner) {
  switch (figure.kind) {
    case "circle":
      return { growth: figure.r - inner.r, skew: 0 };
    case "ring":
      return { growth: figure.outer - inner.outer, skew: 0 };
    default: {
      const dw = figure.w - inner.w;
      const dh = figure.h - inner.h;
      return { growth: (dw / 2 + dh / 2) / 2, skew: figure.kind === "rect" ? Math.abs(dw - dh) : 0 };
    }
  }
}

// Лучшая внутренняя пара для фигуры: положительный рост, наименьший перекос.
function bestInner(figure, fillFigures) {
  return fillFigures
    .filter(
      (inner) =>
        inner.kind === figure.kind &&
        within(inner.cx, figure.cx, TOLERANCE.position) &&
        within(inner.cy, figure.cy, TOLERANCE.position),
    )
    .map((inner) => growthBetween(figure, inner))
    .filter((pair) => pair.growth > 0)
    .reduce((best, pair) => (best === null || pair.skew < best.skew ? pair : best), null);
}

// Ширина обводки группы-кандидата в твипах или null, если это не обводка.
function outlineWidthOf(candidate, fillFigures) {
  const growths = candidate
    .map((figure) => bestInner(figure, fillFigures))
    .filter(Boolean)
    .map((pair) => pair.growth)
    .sort((a, b) => a - b);
  return growths.length === 0 ? null : growths[Math.floor(growths.length / 2)];
}

// ------------------------------------------------------------------ фигуры → поля редактора

// Планка вдоль оси: у какого края лежит и как далеко тянется.
const VERTICAL_BAR = { min: "minY", max: "maxY", before: "top", after: "bottom", thick: "w" };
const HORIZONTAL_BAR = { min: "minX", max: "maxX", before: "left", after: "right", thick: "h" };

function barLines(f, { min, max, before, after, thick }) {
  const thickness = f[thick];
  if (f[max] <= TOLERANCE.position) return [{ side: before, offset: -f[max], end: -f[min], thickness }];
  if (f[min] >= -TOLERANCE.position) return [{ side: after, offset: f[min], end: f[max], thickness }];
  return [
    { side: before, offset: 0, end: -f[min], thickness },
    { side: after, offset: 0, end: f[max], thickness },
  ];
}

const READERS = {
  rect(f, centred) {
    if (centred && within(f.w, f.h, TOLERANCE.position)) return { dot: { shape: "square", size: f.w } };
    if (within(f.cx, 0, TOLERANCE.position) && f.h > f.w) return { lines: barLines(f, VERTICAL_BAR) };
    if (within(f.cy, 0, TOLERANCE.position) && f.w > f.h) return { lines: barLines(f, HORIZONTAL_BAR) };
    return null;
  },
  circle: (f, centred) => (centred ? { dot: { shape: "circle", size: f.r * 2 } } : null),
  diamond: (f, centred) =>
    centred && within(f.w, f.h, TOLERANCE.position)
      ? { dot: { shape: "diamond", size: (f.w / 2) * Math.SQRT2 } }
      : null,
  ring: (f, centred) =>
    centred ? { ring: { size: f.outer + f.inner, thickness: f.outer - f.inner } } : null,
};

function interpret(figure) {
  const centred = within(figure.cx, 0, TOLERANCE.position) && within(figure.cy, 0, TOLERANCE.position);
  return READERS[figure.kind]?.(figure, centred) ?? null;
}

// Самая многочисленная группа линий с одной тройкой «отступ, длина, толщина».
function commonLines(lines) {
  const key = (line) => [line.offset, line.end - line.offset, line.thickness].map(Math.round).join(",");
  return [...bucketBy(lines, key).values()].reduce((best, group) => (group.length > best.length ? group : best), []);
}

function readFigures(figures) {
  return figures.reduce(
    (found, figure) => {
      const meaning = interpret(figure);
      if (meaning === null) return { ...found, unknown: found.unknown + 1 };
      if (meaning.lines) return { ...found, lines: [...found.lines, ...meaning.lines] };
      if (meaning.dot) {
        const bigger = found.dot === null || meaning.dot.size > found.dot.size;
        return bigger ? { ...found, dot: meaning.dot } : found;
      }
      return found.ring === null ? { ...found, ring: meaning.ring } : found;
    },
    { lines: [], dot: null, ring: null, unknown: 0 },
  );
}

// ------------------------------------------------------------------ сравнение рисунков растром

function* endpointsOf(sets) {
  for (const set of sets) {
    for (const region of set) {
      for (const [xa, ya, xb, yb] of region) {
        yield [xa, ya];
        yield [xb, yb];
      }
    }
  }
}

function latticeFor(...sets) {
  const box = extentOf(endpointsOf(sets));
  if (box === null) return null;
  const x0 = Math.floor(box.minX - RASTER.pad);
  const y0 = Math.floor(box.minY - RASTER.pad);
  const width = Math.ceil(box.maxX + RASTER.pad) - x0;
  const height = Math.ceil(box.maxY + RASTER.pad) - y0;
  const step = Math.max(RASTER.minStep, Math.sqrt((width * height) / RASTER.maxCells));
  return { x0, y0, step, cols: Math.ceil(width / step), rows: Math.ceil(height / step) };
}

// Закрашенные промежутки области по центрам строк: [строка, от, до) в клетках.
function* spansOf(segments, { x0, y0, step, cols, rows }) {
  const crossings = new Map();
  for (const [xa, ya, xb, yb] of segments) {
    if (ya === yb) continue;
    const firstRow = Math.max(0, Math.ceil((Math.min(ya, yb) - y0) / step - 0.5));
    const lastRow = Math.min(rows, Math.ceil((Math.max(ya, yb) - y0) / step - 0.5));
    for (let row = firstRow; row < lastRow; row++) {
      const y = y0 + (row + 0.5) * step;
      (crossings.get(row) ?? crossings.set(row, []).get(row)).push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
    }
  }
  const column = (x) => Math.ceil((x - x0) / step - 0.5);
  for (const [row, xs] of crossings) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.min(cols, Math.max(0, column(xs[k])));
      yield [row, from, Math.min(cols, Math.max(from, column(xs[k + 1])))];
    }
  }
}

function rasterize(regions, lattice) {
  const mask = new Uint8Array(lattice.cols * lattice.rows);
  for (const segments of regions) {
    for (const [row, from, to] of spansOf(segments, lattice)) mask.fill(1, row * lattice.cols + from, row * lattice.cols + to);
  }
  return mask;
}

function compareDrawings(left, right, curveLength) {
  const lattice = latticeFor(left, right);
  if (lattice === null) return { share: 0, same: true };
  const a = rasterize(left, lattice);
  const b = rasterize(right, lattice);
  const union = a.reduce((count, cell, i) => count + (cell | b[i]), 0);
  const differ = a.reduce((count, cell, i) => count + (cell !== b[i] ? 1 : 0), 0);
  const cell = lattice.step * lattice.step;
  const allowed = RASTER.areaShare * union * cell + RASTER.curveBand * curveLength;
  return { share: union === 0 ? 0 : differ / union, same: differ * cell <= allowed };
}

function closedSegments(points) {
  return points.map((from, i) => {
    const to = points[(i + 1) % points.length];
    return [from[0], from[1], to[0], to[1]];
  });
}

// Контуры редактора — одна область: «чёт–нечет» делает дыры у колец.
const regionsOfContours = (contours) => (contours.length > 0 ? [contours.flatMap(closedSegments)] : []);

// ------------------------------------------------------------------ тексты потерь

const figureWord = (count) => (count % 10 === 1 && count % 100 !== 11 ? "фигуры" : "фигур");

function joinWords(words) {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} и ${words[words.length - 1]}`;
}

function fillLoss(unknown, share) {
  return unknown > 0
    ? `рисунок обычного прицела — приблизительно: ${unknown} ${figureWord(unknown)} автора в редакторе нет`
    : `рисунок обычного прицела — приблизительно: не совпало ${Math.round(share * 100)} % точек`;
}

function codeLosses(script) {
  if (script === null) return [LOST.noCode];
  return [
    [script.colour === null, LOST.noColour],
    [script.alwaysVisible, LOST.alwaysVisible],
    [customLockOn(script.lockOn), LOST.ownLockOn],
  ]
    .filter(([on]) => on)
    .map(([, text]) => text);
}

// ------------------------------------------------------------------ разбор кадра

// Заливка — самая яркая группа; обводка — первая из остальных, что подошла как обводка.
function analyse(regions) {
  const [fill = null, ...rest] = groupByColour(regions);
  const memo = new Map();
  const figuresFor = (group) => memo.get(group) ?? memo.set(group, figuresOf(group)).get(group);
  const fillFigures = fill ? figuresFor(fill) : [];
  const widths = rest.map((group) => ({ group, width: null }));
  const at = widths.findIndex((entry) => {
    entry.width = outlineWidthOf(figuresFor(entry.group), fillFigures);
    return entry.width !== null;
  });
  const outline = at < 0 ? null : widths[at];
  const others = rest.filter((group) => group !== outline?.group);
  const found = readFigures([...fillFigures, ...others.flatMap(figuresFor)]);
  return { fill, outline, others, found, common: commonLines(found.lines) };
}

// Поля редактора: рисунок белый, а игра сдвигает его цветом из кода класса.
function editorConfig({ fill, outline, found, common }, script) {
  const shift = script?.colour ?? null;
  const paint = (color) => color.slice(0, 3).map((channel, i) => (shift ? channel + shift[i] - 255 : channel));
  const fillRgb = fill ? paint(fill.color) : PLAIN_COLOUR;
  const fillAlpha = fill ? fill.color[3] / 255 : 1;
  const enemy = script ? enemyColour(script.lockOn) : null;
  const first = common[0];
  const hasArm = (side) => common.some((line) => line.side === side);
  const perPoint = (twips) => twips / UNIT.twips;

  const colours = {
    color: rgbToHex(fillRgb),
    opacity: Math.round(fillAlpha * (script?.alpha ?? 100)),
    targetColorEnabled: enemy ? enemy.some((channel, i) => channel !== fillRgb[i]) : false,
    targetColor: rgbToHex(enemy || fillRgb),
  };
  const stroke = {
    outlineEnabled: outline !== null,
    outlineWidth: outline ? perPoint(outline.width) : 0,
    outlineColor: rgbToHex(outline ? paint(outline.group.color) : PLAIN_OUTLINE),
    outlineOpacity: outline ? Math.round((outline.group.color[3] / 255 / fillAlpha) * 100) : 100,
  };
  const bars = {
    linesEnabled: common.length > 0,
    length: first ? perPoint(first.end - first.offset) : 0,
    thickness: first ? perPoint(first.thickness) : 0,
    gap: first ? perPoint(first.offset) : 0,
    armTop: hasArm("top"),
    armRight: hasArm("right"),
    armBottom: hasArm("bottom"),
    armLeft: hasArm("left"),
  };
  const centre = {
    showCenterDot: found.dot !== null,
    dotSize: found.dot ? perPoint(found.dot.size) : 0,
    dotShape: found.dot ? found.dot.shape : "circle",
    ring: found.ring !== null,
    circleSize: found.ring ? perPoint(found.ring.size) : 28,
    ringThickness: found.ring ? perPoint(found.ring.thickness) : 3,
    ringSegments: 1,
  };
  const fixed = {
    bracketsEnabled: false,
    chevronEnabled: false,
    scale: 100,
    rotation: 0,
    visibilityMode: (script?.dimAlpha ?? 0) >= 100 ? "persistent" : "game",
    hitMarker: true,
  };
  return normalizeOrdinaryReticle({ ...colours, ...stroke, ...bars, ...centre, ...fixed });
}

// Проверка: поля снова превращаются в фигуры, и рисунки сравниваются растром.
function verify({ fill, outline, others }, config) {
  const layers = ordinaryReticleLayers(config);
  const fillRegions = [fill, ...others].filter(Boolean).flatMap((group) => group.regions);
  const fillCheck = compareDrawings(
    segmentsOf(fillRegions),
    regionsOfContours(regionContours(layers.fill)),
    sumCurves(fillRegions),
  );
  const needOutline = outline !== null || layers.outline.length > 0;
  const outlineCheck = needOutline
    ? compareDrawings(
        outline ? segmentsOf(outline.group.regions) : [],
        regionsOfContours(regionContours(layers.outline)),
        outline ? outline.group.curves : 0,
      )
    : { share: 0, same: true };
  return { fillCheck, outlineCheck };
}

// Другие обычные стволы: чьи рисунки отличаются от разбираемого кадра.
function differingGuns(gfx, sprite, frame, scan) {
  const drawn = (label) => scanFrame(gfx, sprite, label);
  return GUN_FRAMES.filter(([label]) => label !== frame)
    .map(([label, words]) => ({ words, other: drawn(label) }))
    .filter(({ other }) => {
      const curves = sumCurves(scan.regions) + sumCurves(other.regions);
      return !compareDrawings(segmentsOf(scan.regions), segmentsOf(other.regions), curves).same;
    })
    .map(({ words }) => words);
}

// ------------------------------------------------------------------ вход

export function readModReticle(bytes, { frame = MAIN_LABEL } = {}) {
  const gfx = readGfx(bytes);
  const [sprite] = spritesWithLabels(gfx, [MAIN_LABEL]);
  if (sprite === undefined) {
    throw new Error("В файле нет спрайта прицела с кадром WEAPONTYPE_RIFLE — это не hud_reticle.gfx.");
  }
  const script = readReticleScript(gfx);
  const scan = scanFrame(gfx, sprite, frame);
  const analysis = analyse(scan.regions);
  const config = editorConfig(analysis, script);
  const { fillCheck, outlineCheck } = verify(analysis, config);
  const { outline, others, found } = analysis;
  const differing = differingGuns(gfx, sprite, frame, scan);

  const verdicts = [
    [!fillCheck.same, () => fillLoss(found.unknown, fillCheck.share)],
    [!outlineCheck.same, () => (outline ? LOST.outlineApprox : LOST.outlineMissing)],
    [others.length > 0, () => LOST.otherColours],
    [scan.skipped > 0, () => LOST.skipped],
    [differing.length > 0, () => `свой прицел ${joinWords(differing)} — в редакторе один прицел на все обычные стволы`],
  ];
  const lost = [...verdicts.filter(([on]) => on).map(([, text]) => text()), LOST.scope, ...codeLosses(script)];

  const nothingToDraw = scan.regions.length === 0 && scan.skipped === 0;
  return {
    config,
    exact: fillCheck.same && outlineCheck.same,
    difference: Math.max(fillCheck.share, outlineCheck.share),
    lost,
    recognised: nothingToDraw || found.lines.length > 0 || found.dot !== null || found.ring !== null,
  };
}
