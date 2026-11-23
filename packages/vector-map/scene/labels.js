import { chooseZoneLabel, zoneLabelVariants } from "../label-fit.js";
import { round } from "./geometry.js";

export const LABEL_FITS_LIMIT = 4000;
const SHADOW_PREFIX = "marker-shadow-";
export const MIN_LABEL_SHRINK = 0.4;
const LABEL_PREFIX = "marker-label-";
// Память раскладок подписей зон: одна на модуль, вытеснение по порядку вставки.
export const LABEL_FITS = new Map();
const REGION_RANK = -1;
export const LABEL_CELL = 128;

const SHADOW_HEAD = new RegExp(`^${SHADOW_PREFIX}`);
const SETTLE_STEPS = [0, ...[0.5, 1].flatMap((side) => [-side, side])];
const OPEN_FIELD = Object.freeze({ width: Infinity, height: Infinity });
const [HASH_START, HASH_PRIME, HASH_SCALE] = [2166136261, 16777619, 10];

// Таблицы коэффициентов; ряд выбирается по признаку (0/1).
const HALF_FACTORS = [0.54, 0.66];
const BOX_FACTORS = [[0.54, 0.58], [0.66, 0.72]];
const BOX_HEIGHTS = [1.05, 0.74];
const LINE_STEP = 1.12;
const PADDING = 0.16;

// --- ширина и рамка подписи ----------------------------------------------

function isCaps(line) {
  return line === line.toLocaleUpperCase("ru");
}

function glyphs(line) {
  return Math.max(line.length, 1);
}

const isWide = (family) => String(family || "").startsWith("Inter");

function factorFor(line, family) {
  return BOX_FACTORS[+isCaps(line)][+isWide(family)];
}

function rowWidth(count, size, factor, spacing) {
  return count * size * factor + spacing * (count - 1);
}

const longerLine = (best, line) => (best.length < line.length ? line : best);

function halfSpan(line, size, spacing) {
  return rowWidth(glyphs(line), size, HALF_FACTORS[+isCaps(line)], spacing) / 2;
}

export function labelHalfWidth(text, size, letterSpacing = 0) {
  return halfSpan(String(text), size, letterSpacing);
}

// Строки подписи: список, если у него есть длина, иначе одна строка из значения.
function rowsOf(item) {
  if (item.lines?.length) return item.lines;
  return [String(item.value)];
}

// У закреплённой подписи ширина берётся из fitSpacing, у прочих считается по числу знаков.
function widthOf(item, fixed, count, factor) {
  if (fixed && item.fitSpacing) return item.fitSpacing;
  return rowWidth(count, item.size, factor, item.letterSpacing || 0);
}

// Высота стопки строк: первая строка плюс шаг на каждую следующую (произведение считается и при нуле).
function stackHeight(item, fixed, rowCount) {
  const first = item.size * BOX_HEIGHTS[+fixed];
  const step = item.lineStep || item.size * LINE_STEP;
  return first + (rowCount - 1) * step;
}

const radians = (degrees) => (degrees * Math.PI) / 180;

// Половины рамки по осям для повёрнутого прямоугольника; для нулевого угла косинус 1, синус 0 без вызовов.
function halves(width, height, rotation) {
  const turn = radians(rotation || 0);
  const cos = turn ? Math.abs(Math.cos(turn)) : 1;
  const sin = turn ? Math.abs(Math.sin(turn)) : 0;
  return [(width * cos + height * sin) / 2, (width * sin + height * cos) / 2];
}

// Рамка кладётся прямо в переданную запись: у расстановки это её собственная запись.
function boxInto(item, out) {
  const lines = rowsOf(item),
    longest = lines.reduce(longerLine, "");
  const factor = factorFor(longest, item.family),
    fixed = Boolean(item.fixed);
  const width = widthOf(item, fixed, glyphs(longest), factor);
  const height = stackHeight(item, fixed, lines.length);
  const pad = fixed ? 0 : item.size * PADDING;
  const [halfWide, halfTall] = halves(width, height, item.rotation);
  out.left = item.x - halfWide - pad;
  out.right = item.x + halfWide + pad;
  out.top = item.y - halfTall - pad;
  out.bottom = item.y + halfTall + pad;
  return out;
}

export const labelBox = (item) => boxInto(item, {});

// --- сетка рамок ---------------------------------------------------------

const cellOf = (value) => Math.floor(value / LABEL_CELL);
const isExact = (box) => [box.left, box.right, box.top, box.bottom].every(Number.isFinite);

// Ключи ячеек, которых касается рамка: внешний цикл по столбцам, внутренний по строкам.
function cellKeys(box) {
  const keys = [];
  const [rowFrom, rowTo] = [cellOf(box.top), cellOf(box.bottom)];
  for (let col = cellOf(box.left), lastCol = cellOf(box.right); col <= lastCol; col++) {
    for (let row = rowFrom; row <= rowTo; row++) keys.push(`${col}:${row}`);
  }
  return keys;
}

// Ячейки и общий список хранят записи плоско: номер, запись, номер, запись…
class CellIndex {
  constructor() {
    this.cells = new Map();
    this.loose = [];
    this.bestIndex = Infinity;
    this.found = undefined;
  }

  add(entry, index) {
    if (!isExact(entry)) {
      this.loose.push(index, entry);
      return;
    }
    for (const key of cellKeys(entry)) {
      const list = this.cells.get(key);
      if (list === undefined) this.cells.set(key, [index, entry]);
      else list.push(index, entry);
    }
  }

  scan(list, test) {
    for (let k = 0; k < list.length; k += 2) {
      if (list[k] < this.bestIndex && test(list[k + 1])) {
        this.bestIndex = list[k];
        this.found = list[k + 1];
      }
    }
  }

  first(box, test) {
    this.bestIndex = Infinity;
    this.found = undefined;
    this.scan(this.loose, test);
    if (isExact(box)) {
      for (const key of cellKeys(box)) {
        const list = this.cells.get(key);
        if (list !== undefined) this.scan(list, test);
      }
    } else {
      this.cells.forEach((list) => this.scan(list, test));
    }
    return this.found;
  }
}

export const labelGrid = () => new CellIndex();

// --- владельцы и ключи ---------------------------------------------------

export const labelOwner = (id) => (id ? String(id).replace(SHADOW_HEAD, LABEL_PREFIX) : "");

const orphaned = (item, present) => item.id.startsWith(SHADOW_PREFIX) && !present.has(labelOwner(item.id));
const idOf = (item) => item.id;
const notOrphan = (present) => (item) => !orphaned(item, present);

export function withOwners(labels) {
  const present = new Set(labels.map(idOf));
  return labels.filter(notOrphan(present));
}

export const labelKey = (value) => (value ? String(value).trim().toLocaleLowerCase("ru") : "");

function joinedText(item) {
  if (item.lines?.length) return item.lines.join(" ");
  return item.value;
}

export function repeatKey(item) {
  return labelKey(joinedText(item)).replaceAll("ё", "е").split(/\s+/).join(" ");
}

export function approximateAdvance(text, family) {
  const line = text ? String(text) : "";
  return line.length * factorFor(line, family);
}

// --- расстановка ---------------------------------------------------------

class Placed {
  constructor() {
    this.left = 0;
    this.right = 0;
    this.top = 0;
    this.bottom = 0;
    this.rank = 1;
    this.id = undefined;
    this.fixed = undefined;
    this.group = undefined;
  }
}

function entryFor(label, source = label) {
  const entry = boxInto(source, new Placed());
  entry.rank = label.rank ?? 1;
  entry.id = label.id;
  entry.fixed = label.fixed;
  entry.group = label.group;
  return entry;
}

function crosses(lowA, highA, lowB, highB) {
  return lowA < highB && highA > lowB;
}

function overlaps(a, b) {
  return crosses(a.left, a.right, b.left, b.right) && crosses(a.top, a.bottom, b.top, b.bottom);
}

const ownerOf = (entry) => labelOwner(entry.id);
const isLifted = (lifted, id) => lifted?.has(id);

// Расстановка автора пака: обе закреплённые, одна непустая группа, ни одна не поднята окном.
function sameAuthor(a, b, lifted) {
  if (!(a.fixed && b.fixed && a.group)) return false;
  return a.group === b.group && !isLifted(lifted, a.id) && !isLifted(lifted, b.id);
}

// Три случая, когда налезание не считается.
const COEXIST_RULES = [
  sameAuthor,
  (a, b) => Boolean(a.fixed) !== Boolean(b.fixed),
  (a, b) => ownerOf(a) === ownerOf(b) && a.id !== b.id,
];

function mayCoexist(a, b, lifted) {
  return COEXIST_RULES.some((rule) => rule(a, b, lifted));
}

const roomIn = (center, reach, bounds, side) => center - reach >= 0 && center + reach <= bounds[side];
const byReach = (a, b) => a.reach - b.reach;
const extentOf = (box) => [(box.bottom - box.top) / 2, box.right - box.left];
const relocated = (label, x, y) => ({ ...label, x, y });
const landing = (spot) => Object.fromEntries([["x", round(spot.x)], ["y", round(spot.y)]]);

function distanceFrom(label, spot) {
  return Math.hypot(...[[spot.x, label.x], [spot.y, label.y]].map(([to, from]) => to - from));
}

function settingsOf(options) {
  const [blockers, moved, lifted] = [options.blockers, options.moved, options.lifted].map((value) => value ?? null);
  const given = options.bounds;
  return { blockers, moved, lifted, bounds: given === undefined ? OPEN_FIELD : given };
}

export function declutterLabels(ordered, options = {}) {
  const { blockers, moved, lifted, bounds } = settingsOf(options);
  const kept = new Set();
  const grid = labelGrid();
  const waiting = [];
  let placedCount = 0;
  let probe = null;
  let tier;

  const hinders = (old) => overlaps(probe, old) && !mayCoexist(probe, old, lifted);

  const take = (label, entry) => {
    grid.add(entry, placedCount++);
    kept.add(label.id);
  };

  // Место для подписи, налезшей на регион: десять кандидатов, ближайшие к исходному месту — первыми.
  const findRoom = (label, region, half, span) => {
    const below = region.bottom + half;
    const above = region.top - half;
    const spots = [below, above].flatMap((y) => SETTLE_STEPS.map((shift) => ({ x: shift * span + label.x, y })));
    const ranked = Array.from(spots, (spot, n) => ({ spot, n, reach: distanceFrom(label, spot) }));
    ranked.sort((a, b) => byReach(a, b) || a.n - b.n);
    for (const { spot } of ranked) {
      if (!(roomIn(spot.y, half, bounds, "height") && roomIn(spot.x, span / 2, bounds, "width"))) continue;
      probe = entryFor(label, relocated(label, spot.x, spot.y));
      if (!grid.first(probe, hinders)) return { spot, entry: probe };
    }
    return null;
  };

  const settle = () => {
    waiting.splice(0).forEach(({ label, entry, region }) => {
      const [half, span] = extentOf(entry);
      const room = findRoom(label, region, half, span);
      if (room === null) {
        blockers?.set(label.id, REGION_RANK);
      } else {
        moved?.set(label.id, landing(room.spot));
        take(label, room.entry);
      }
    });
  };

  // Новый ярус по рангу (сравнение строгое): сначала разбираются ожидающие прежнего яруса.
  const enter = (rank) => {
    if (rank === tier) return;
    settle();
    tier = rank;
  };

  const decide = (label, entry, blocker) => {
    if (blocker === undefined) {
      take(label, entry);
      return;
    }
    if (blocker.rank === REGION_RANK && entry.rank >= 0 && !entry.fixed) {
      waiting.push({ label, entry, region: blocker });
      return;
    }
    blockers?.set(label.id, blocker.rank);
  };

  for (const label of ordered) {
    enter(label.rank ?? 1);
    probe = entryFor(label);
    decide(label, probe, grid.first(probe, hinders));
  }
  settle();
  return kept;
}

// --- подпись зоны по фигуре ----------------------------------------------

// Свёртка контура: координата ×10, округление, исключающее «или», 32-битное умножение.
const fold = (hash, value) => Math.imul(hash ^ Math.round(value * HASH_SCALE), HASH_PRIME);

function outlineHash(points) {
  let hash = HASH_START;
  for (const point of points) hash = fold(fold(hash, point.x), point.y);
  return hash >>> 0;
}

// Замер строки: ответ окна, если он истинный, иначе запасное приближение; плюс разрядка между знаками.
function meterFor(textAdvance, family, weight, spacing) {
  const ask = typeof textAdvance === "function" ? textAdvance : () => null;
  return (value) => {
    const advance = ask({ value, family, weight, spacing: 0 }) || approximateAdvance(value, family);
    const between = Math.max([...value].length - 1, 0) * spacing;
    return advance + between;
  };
}

// После вставки сверх предела уходит самая давняя запись (чтение порядок не меняет).
function forgetOldest() {
  if (LABEL_FITS.size <= LABEL_FITS_LIMIT) return;
  const [oldest] = LABEL_FITS.keys();
  LABEL_FITS.delete(oldest);
}

// Память по ключу: раскладка считается один раз.
function recall(key, build) {
  const known = LABEL_FITS.get(key);
  if (known !== undefined) return known;
  const fresh = build();
  LABEL_FITS.set(key, fresh);
  forgetOldest();
  return fresh;
}

export function zoneLabelFit(id, points, text, family, weight, textAdvance, inset, wanted, spacing = 0) {
  const measure = meterFor(textAdvance, family, weight, spacing);
  const shape = outlineHash(points);
  const key = `${id}|${shape}|${points.length}|${text}|${weight}|${round(measure(text))}|${round(inset)}`;
  const variants = recall(key, () => zoneLabelVariants(points, text, measure, { inset }));
  return chooseZoneLabel(variants, wanted);
}

// --- пометка цветом по фону ----------------------------------------------

const markOf = (base, keepHue) => Object.assign({ tone: base }, keepHue ? { keepHue: true } : null);

// Цвет, обводка и её толщина по замеру: ореол читается трижды (условие, цвет, множитель).
function inkOf(label, seen) {
  const fill = seen.fill;
  const stroke = seen.halo > 0 ? seen.stroke : null;
  const strokeWidth = seen.halo > 0 ? round(label.size * seen.halo) : 0;
  return { fill, stroke, strokeWidth };
}

function toned(label, base, tones, keepHue) {
  const seen = tones?.[label.id];
  const copy = { ...label, ...markOf(base, keepHue) };
  return seen ? Object.assign(copy, inkOf(label, seen)) : copy;
}

export function withTone(label, base, tones, keepHue = false) {
  return base ? toned(label, base, tones, keepHue) : label;
}
