import { GLYPH_BOX } from "../glyphs.js";
import { boundaryLoops, boxGap, boxGrid, isDot, ringArea, unionFind } from "./parts.js";
import { simplify } from "./lines.js";

const HALO_GRID_CELL = 120;
const ICON_GRID_CELL = 60;
const ICON_HALF = 128;
const ICON_FILL = 0.92;
const ICON_TOLERANCE = 0.45;
const HUE_SPREAD = 25;
const LIGHTNESS_GAP = 20;
const AXES = [0, 1];
const FLIP_Y = [1, -1];

// ---------- рамки и точки как пары по осям ----------

const lowOf = (box) => [box.x0, box.y0];
const highOf = (box) => [box.x1, box.y1];
const boxFrom = ([x0, y0], [x1, y1]) => ({ x0, y0, x1, y1 });
const grown = (box, by) => boxFrom(lowOf(box).map((value) => value - by), highOf(box).map((value) => value + by));
const areaOf = (box) => AXES.map((axis) => highOf(box)[axis] - lowOf(box)[axis]).reduce((width, height) => width * height);
const holds = (box, point) => AXES.every((axis) => lowOf(box)[axis] <= point[axis] && point[axis] <= highOf(box)[axis]);
const offset = (to, from) => AXES.map((axis) => to[axis] - from[axis]);
const lengthOf = (vector) => Math.hypot(...vector);

const neighbours = (grid, box, reach) => {
  const found = [];
  grid.near(box, reach, found.push.bind(found));
  return found;
};

/** Какую долю меньшей из двух рамок занимает их пересечение. */
const overlapShare = (a, b) => {
  const widths = AXES.map((axis) => Math.min(highOf(a)[axis], highOf(b)[axis]) - Math.max(lowOf(a)[axis], lowOf(b)[axis]));
  if (widths.some((width) => width <= 0)) return 0;
  const smaller = Math.min(areaOf(a), areaOf(b));
  return smaller > 0 ? (widths[0] * widths[1]) / smaller : 0;
};

// Поворот на угол подписи: u идёт вдоль строки, v поперёк.
const spinOf = (angle) => [Math.cos(angle), Math.sin(angle)];
const intoFrame = ([x, y], [cos, sin]) => [x * cos + y * sin, -x * sin + y * cos];
const outOfFrame = ([u, v], [cos, sin]) => [u * cos - v * sin, u * sin + v * cos];

// ---------- цвет ----------

const rgbValue = (color) => parseInt(color.slice(1), 16);
const channelsOf = (color) => [16, 8, 0].map((shift) => (rgbValue(color) >> shift) & 255);

const LIGHTNESS_WEIGHTS = [0.2126, 0.7152, 0.0722];
const lightnessOf = (color) => channelsOf(color).reduce((sum, channel, i) => sum + LIGHTNESS_WEIGHTS[i] * channel, 0);

/** Оттенок в градусах или null, если цвет тёмный либо серый. */
const hueOf = (color) => {
  const rgb = channelsOf(color).map((channel) => channel / 255);
  const max = Math.max(...rgb);
  const range = max - Math.min(...rgb);
  if (max < 0.25 || range / max < 0.3) return null;
  const dominant = rgb.indexOf(max);
  const lean = (rgb[(dominant + 1) % 3] - rgb[(dominant + 2) % 3]) / range;
  return ((dominant === 0 ? lean % 6 : lean + 2 * dominant) * 60 + 360) % 360;
};

const angleGap = (a, b) => {
  const wrapped = Math.abs(a - b) % 360;
  return 360 - wrapped < wrapped ? 360 - wrapped : wrapped;
};

const withinSpread = (own, letters) => letters !== null && angleGap(own, letters) <= HUE_SPREAD;

/** Цвет отделки подходит буквам: у отделки нет оттенка, либо оттенки в пределах 25 градусов. */
const toneFits = (partColor, lettersColor) => {
  const own = hueOf(partColor);
  return own === null || withinSpread(own, hueOf(lettersColor));
};

// ---------- attachHalos ----------

/** Буквы подписи: куски без тех, что уже ушли в её отделку (по тождеству объектов). */
const lettersOf = (label) => {
  const spent = new Set(label.decor);
  return label.parts.filter((part) => !spent.has(part));
};

const topGroupOf = (letters) => letters.reduce((top, letter) => Math.max(top, letter.groupIndex), -Infinity);

const searchBoxOf = (label) => {
  const reach = lengthOf([label.width, label.height * 4]) / 2 + label.height;
  return grown(boxFrom([label.x, label.y], [label.x, label.y]), reach);
};

/** Все точки куска лежат в повёрнутой рамке подписи, расширенной на grow. */
const insideLabelBox = (part, label, grow) => {
  const { u0, u1, v0, v1, angle } = label.box;
  const spin = spinOf(angle);
  const limits = [
    [u0, u1],
    [v0, v1],
  ];
  return part.points.every((point) => {
    const local = intoFrame(point, spin);
    return limits.every(([low, high], axis) => !(local[axis] < low - grow || local[axis] > high + grow));
  });
};

const touchesLetters = (part, letters, depth) => {
  const reached = letters.map((letter) => grown(letter, depth));
  return reached.some((box) => overlapShare(part, box) >= 0.5);
};

const coversLetter = (part, letters, slack) => {
  const centre = [part.cx, part.cy];
  return letters.some((letter) => holds(grown(letter, slack), centre));
};

// Правила, по которым кусок становится отделкой подписи; первая неудача отказывает.
const HALO_RULES = [
  ({ part, letters }) => !(part.groupIndex >= topGroupOf(letters)),
  ({ part, label }) => lightnessOf(label.color) - LIGHTNESS_GAP > lightnessOf(part.group.color),
  ({ part, label }) => toneFits(part.group.color, label.color),
  ({ part, label }) => insideLabelBox(part, label, 0.5 * label.height),
  ({ part, label, letters }) => touchesLetters(part, letters, 0.3 * label.height),
  ({ part, label, letters, dot }) => !dot || coversLetter(part, letters, 0.1 * label.height),
];

const isHaloOf = (label, part, dot) => {
  const context = { part, label, dot, letters: lettersOf(label) };
  return HALO_RULES.every((rule) => rule(context));
};

const adopt = (label, part) => {
  label.decor ||= [];
  [label.decor, label.parts].forEach((list) => list.push(part));
};

/**
 * Тёмная подложка под буквами (ореол, бока, тень) уходит в саму подпись: дописывается в её decor и parts.
 * Возвращает куски, которые отделкой не стали.
 */
export const attachHalos = (labels, parts) => {
  const grid = boxGrid(
    labels.map((label) => searchBoxOf(label)),
    HALO_GRID_CELL,
  );
  const pickLabel = (index) => labels[index];
  const claim = (part) => {
    const dot = isDot(part);
    const accepts = (label) => isHaloOf(label, part, dot);
    const owner = neighbours(grid, part, 0).map(pickLabel).find(accepts);
    if (owner) adopt(owner, part);
    return Boolean(owner);
  };
  return [...parts].filter((part) => !claim(part));
};

// ---------- pairPoints: нарезка слипшихся номеров ----------

const isDigits = (text, min, max) => text.length >= min && text.length <= max && [...text].every((char) => char >= "0" && char <= "9");

const compact = (text) => [...text].filter((char) => char.trim() !== "").join("");

const linesOf = (text) =>
  String(text)
    .split("\n")
    .flatMap((line) => (line.trim() === "" ? [] : [line.trim()]));

const ascending = (a, b) => a - b;
const median = (values) => values.slice().sort(ascending).at(Math.floor(values.length / 2)) ?? 0;

/** Повёрнутый размах куска: lo и hi — пары [u, v]. */
const spanOf = (part, spin) => {
  const framed = part.points.map((point) => intoFrame(point, spin));
  return {
    part,
    lo: AXES.map((axis) => framed.reduce((low, point) => Math.min(low, point[axis]), Infinity)),
    hi: AXES.map((axis) => framed.reduce((high, point) => Math.max(high, point[axis]), -Infinity)),
  };
};

const byLeftEdge = (a, b) => a.lo[0] - b.lo[0];
const topFirst = (a, b) => b.hi[1] + b.lo[1] - (a.hi[1] + a.lo[1]);

/** Склеивает пересекающиеся по ширине куски одного ряда в буквы (слева направо). */
const glueLetters = (spans) =>
  [...spans].sort(byLeftEdge).reduce((letters, span) => {
    const last = letters.at(-1);
    if (last && span.lo[0] < last.hi[0] - 0.3 * (span.hi[0] - span.lo[0])) {
      last.hi = [Math.max(last.hi[0], span.hi[0]), Math.max(last.hi[1], span.hi[1])];
      last.lo = [last.lo[0], Math.min(last.lo[1], span.lo[1])];
      last.parts.push(span.part);
    } else {
      letters.push({ lo: [...span.lo], hi: [...span.hi], parts: [span.part] });
    }
    return letters;
  }, []);

/** Жадно собирает куски в ряды сверху вниз; ряд сравнивается с серединой своего первого куска. */
const gatherRows = (spans, height) =>
  [...spans].sort(topFirst).reduce((rows, span) => {
    const centre = (span.lo[1] + span.hi[1]) / 2;
    const row = rows.at(-1);
    if (row && Math.abs(row.centre - centre) <= 0.6 * height) row.spans.push(span);
    else rows.push({ centre, spans: [span] });
    return rows;
  }, []);

// Где кончается каждый кусок нарезки (номер буквы после последней буквы куска).
const wordEnds = (words) => words.map((_, k) => words.slice(0, k + 1).join("").length);

const gapEnds = (letters, height) => {
  const gaps = letters.slice(1).map((letter, i) => letter.lo[0] - letters[i].hi[0]);
  const cut = Math.max(0.25 * height, 2 * Math.max(median(gaps), 0));
  return [...gaps.flatMap((gap, i) => (gap > cut ? [i + 1] : [])), letters.length];
};

/** Режет ряд букв: по словам, если OCR увидел пробел, иначе по заметно широким промежуткам. */
const cutRow = (letters, words, height) => {
  const chars = words.join("");
  const ends = words.length > 1 ? wordEnds(words) : gapEnds(letters, height);
  return ends.map((end, k) => {
    const start = k === 0 ? 0 : ends[k - 1];
    return { text: chars.slice(start, end), letters: letters.slice(start, end) };
  });
};

/** Новая подпись из букв одного куска нарезки. */
const pieceLabel = (label, { text, letters }, spin) => {
  const lo = AXES.map((axis) => Math.min(...letters.map((letter) => letter.lo[axis])));
  const hi = AXES.map((axis) => Math.max(...letters.map((letter) => letter.hi[axis])));
  const [x, y] = outOfFrame(
    AXES.map((axis) => (lo[axis] + hi[axis]) / 2),
    spin,
  );
  return {
    ...label,
    text,
    x,
    y,
    width: hi[0] - lo[0],
    box: { u0: lo[0], u1: hi[0], v0: lo[1], v1: hi[1], angle: label.box.angle },
    parts: letters.flatMap((letter) => letter.parts),
    decor: [],
    piece: label,
  };
};

/** Куски нарезки по строкам текста или null, если ряды и буквы не сходятся со знаками. */
const cutsOf = (label, lines, spin) => {
  const rows = gatherRows(
    lettersOf(label).map((part) => spanOf(part, spin)),
    label.height,
  );
  const wordLists = lines.map((line) => line.split(/\s+/));
  const letterRows = rows.map((row) => glueLetters(row.spans));
  const aligned = rows.length === lines.length && letterRows.every((letters, i) => letters.length === wordLists[i].join("").length);
  return aligned ? letterRows.flatMap((letters, i) => cutRow(letters, wordLists[i], label.height)) : null;
};

/** Слипшиеся номера («27 28», «2520», стопка) режутся на отдельные подписи; иначе подпись возвращается сама. */
const unglue = (label) => {
  const lines = linesOf(label.text);
  if (!isDigits(compact(lines.join("")), 2, 12) || isDigits(String(label.text), 1, 3)) return [label];
  const spin = spinOf(label.box.angle);
  const cuts = cutsOf(label, lines, spin);
  return cuts && cuts.length >= 2 ? cuts.map((cut) => pieceLabel(label, cut, spin)) : [label];
};

// ---------- pairPoints ----------

const NO_NUMBER = Object.freeze({ text: "", height: 0, width: 0, color: null, parts: [] });

const dotOf = (part) => ({
  spot: [part.cx, part.cy],
  radius: Math.sqrt(part.area / Math.PI),
  color: part.group.color,
  parts: [part],
  number: null,
});

const pointOf = ({ spot: [x, y], radius, color, parts, number }) => {
  const tag = number ?? NO_NUMBER;
  const [dx, dy] = number ? offset([tag.x, tag.y], [x, y]) : [0, 0];
  return {
    number: tag.text,
    x,
    y,
    radius,
    color,
    dx,
    dy,
    height: tag.height,
    width: tag.width,
    labelColor: tag.color,
    parts: [...parts, ...tag.parts],
  };
};

const nearestFirst = (a, b) => a.gap - b.gap;

/**
 * Залитые кружки с цифрой рядом становятся точками с номерами.
 * Возвращает { points, labels, rest }.
 */
export const pairPoints = (labels, parts) => {
  const sorted = [...parts].map((part) => [part, isDot(part)]);
  const dots = sorted.filter(([, dot]) => dot).map(([part]) => dotOf(part));
  const rest = sorted.filter(([, dot]) => !dot).map(([part]) => part);

  const numbers = labels.flatMap((label) => unglue(label)).filter((label) => isDigits(String(label.text), 1, 3));
  const pairsOf = (label) =>
    dots.map((dot) => ({
      label,
      dot,
      gap: lengthOf(offset([label.x, label.y], dot.spot)),
      reach: [2.2 * label.height, dot.radius, label.width / 2].reduce((sum, term) => sum + term),
    }));
  const pairs = numbers
    .flatMap(pairsOf)
    .filter(({ gap, reach }) => gap <= reach)
    .sort(nearestFirst);

  const taken = new Set();
  pairs.forEach(({ label, dot }) => {
    if (taken.has(label) || dot.number) return;
    dot.number = label;
    taken.add(label);
  });

  const parents = new Set(Array.from(taken, (label) => label.piece).filter(Boolean));
  const gone = new Set([...taken, ...parents]);
  const leftovers = numbers.filter((label) => !taken.has(label) && parents.has(label.piece));
  return { points: dots.map(pointOf), labels: [...labels.filter((label) => !gone.has(label)), ...leftovers], rest };
};

// ---------- extractIcons ----------

const pathOf = (loops) => loops.map((loop) => "M" + loop.map((point) => point.join(" ")).join("L") + "Z").join("");

const largestFirst = (a, b) => Math.abs(b.area) - Math.abs(a.area);
const byHeight = (a, b) => a.group.height - b.group.height;
const hundredths = (value) => Math.round(value * 100) / 100;
const withArea = (ring) => ({ ring, area: ringArea(ring) });
const closed = ({ length }) => length >= 3;

/** Контур значка в квадрате GLYPH_BOX: целые точки без повторов подряд. */
const tidy = (ring, centre, scale) => {
  const moved = ring.map((point) => {
    const delta = offset(point, centre);
    return AXES.map((axis) => ICON_HALF + FLIP_Y[axis] * delta[axis] * scale);
  });
  return simplify([...moved, moved[0]], ICON_TOLERANCE)
    .slice(0, -1)
    .map((point) => point.map(Math.round))
    .filter((point, i, all) => i === 0 || !point.every((value, axis) => value === all[i - 1][axis]));
};

/** Внешний контур куска — против часовой, дыры — по; совсем малые петли отброшены. */
const outlinesOf = (part, centre, scale) => {
  const [positions, tris] = [part.group.positions, part.tris];
  const rings = boundaryLoops(positions, tris).map(withArea).sort(largestFirst);
  const tiny = 0.001 * Math.abs(rings[0]?.area ?? 0);
  return rings
    .map((item, index) => ({ ...item, wanted: index === 0 ? 1 : -1 }))
    .filter(({ area }) => !(Math.abs(area) < tiny))
    .map(({ ring, area, wanted }) => tidy(Math.sign(area) === wanted ? ring : [...ring].reverse(), centre, scale))
    .filter(closed);
};

/** Слои значка снизу вверх: куски одного цвета и прозрачности — один слой. */
const iconLayers = (list, centre, size) => {
  const room = GLYPH_BOX * ICON_FILL;
  const scale = room / Math.max(size, 1e-6);
  const byKey = [...list].sort(byHeight).reduce((layers, part) => {
    const { color, alpha } = part.group;
    const key = color + "|" + alpha;
    const layer = layers.get(key) ?? { color, alpha, parts: [] };
    layer.parts.push(part);
    return layers.set(key, layer);
  }, new Map());
  return [...byKey.values()].map(({ color, alpha, parts }) => ({
    color,
    alpha: hundredths(alpha),
    area: parts.reduce((sum, part) => sum + part.area, 0),
    loops: parts.flatMap((part) => outlinesOf(part, centre, scale)),
  }));
};

const meanOf = (loop, axis) => loop.reduce((sum, point) => sum + point[axis], 0) / loop.length;

const similarLoop = (left, right) => {
  const allowed = Math.max(2, 0.08 * left.length);
  if (Math.abs(right.length - left.length) > allowed) return false;
  if (AXES.some((axis) => Math.abs(meanOf(left, axis) - meanOf(right, axis)) > 1.5)) return false;
  const leftArea = ringArea(left);
  return Math.abs(ringArea(right) - leftArea) <= 0.03 * Math.abs(leftArea) + 4;
};

const similarLoops = (left, right) => left.length === right.length && left.every((loop, i) => similarLoop(loop, right[i]));
const sameLayer = (a, b) => a.color === b.color && similarLoops(a.loops, b.loops);
const sameSize = (a, b) => !(Math.abs(a - b) > 0.03 * b);

const withLoops = ({ loops }) => loops.length > 0;
const glyphLayer = ({ loops, color, alpha }) => ({ path: pathOf(loops), color, alpha });

/** Уже встреченные значки: одинаковые делят один глиф. */
const glyphBook = () => {
  const known = [];
  const glyphs = {};
  const idFor = (size, layers) => {
    const matches = (entry) =>
      entry.layers.length === layers.length && sameSize(entry.size, size) && entry.layers.every((layer, i) => sameLayer(layer, layers[i]));
    const twin = known.find(matches);
    if (twin) return twin.id;
    const id = `g${known.length + 1}`;
    known.push({ id, size, layers });
    glyphs[id] = { layers: layers.filter(withLoops).map(glyphLayer) };
    return id;
  };
  return { glyphs, idFor };
};

const extentOf = (boxes) => [
  AXES.map((axis) => boxes.reduce((low, box) => Math.min(low, lowOf(box)[axis]), Infinity)),
  AXES.map((axis) => boxes.reduce((high, box) => Math.max(high, highOf(box)[axis]), -Infinity)),
];

const describeIcon = (list, book) => {
  const [lo, hi] = extentOf(list);
  const size = Math.max(...AXES.map((axis) => hi[axis] - lo[axis]), 0.5);
  const centre = AXES.map((axis) => (lo[axis] + hi[axis]) / 2);
  const layers = iconLayers(list, centre, size);
  const main = layers.reduce((best, layer) => (layer.area > best.area ? layer : best));
  return { x: centre[0], y: centre[1], size, glyph: book.idFor(size, layers), color: main.color, parts: list };
};

/** Куски, которые стоит склеить в один значок: близкие, соизмеримые либо мелкий внутри крупного. */
const related = (part, mate) => {
  const longs = [part.long, mate.long];
  const [big, small] = [Math.max(...longs), Math.min(...longs)];
  if (boxGap(part, mate) > 0.15 * big + 0.5) return false;
  const [host, guest] = mate.long > part.long ? [mate, part] : [part, mate];
  return small >= 0.2 * big || holds(host, [guest.cx, guest.cy]);
};

/**
 * Склеивает близкие куски в значки; контуры значка — путь SVG, одинаковые значки делят один путь.
 * Возвращает { icons, glyphs }.
 */
export const extractIcons = (parts) => {
  const grid = boxGrid(parts, ICON_GRID_CELL);
  const sets = unionFind(parts.length);
  parts.forEach((part, index) => {
    neighbours(grid, part, 0.15 * part.long + 0.5)
      .filter((other) => other > index && related(part, parts[other]))
      .forEach((other) => sets.join(index, other));
  });
  const book = glyphBook();
  const icons = sets.groups().map((indexes) => describeIcon(indexes.map((i) => parts[i]), book));
  return { icons, glyphs: book.glyphs };
};
