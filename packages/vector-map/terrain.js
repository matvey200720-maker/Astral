import { hexToRgb, rgbToHex } from "./color.js";
import heights from "./terrain-heights.json" with { type: "json" };

const UPSAMPLE = 2;
const SOFTEN_PASSES = 1;
const SHADOW_STEPS = [0.03, 0.08, 0.14, 0.22, 0.32, 0.45];
const LIGHT_STEPS = [0.03, 0.07, 0.12, 0.18];
const TINT_STEPS = [40, 90, 160, 250, 360, 500, 650];
const CACHE_LIMIT = 12;
const THIN_GAP_CELLS = 0.35;

const freezeDeep = (value) => {
  if (value !== null && typeof value === "object") Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

export const TERRAIN_PRESETS = freezeDeep([
  { id: "soft", title: "Мягкий", patch: { reliefShade: 45, reliefHeight: 100, reliefTint: 0, reliefContours: false } },
  { id: "mountains", title: "Горы", patch: { reliefShade: 80, reliefHeight: 170, reliefTint: 0, reliefContours: false } },
  { id: "topo", title: "Топокарта", patch: { reliefShade: 35, reliefHeight: 100, reliefTint: 55, reliefContours: true, reliefStep: 50 } },
  { id: "lines", title: "Горизонтали", patch: { reliefShade: 0, reliefTint: 0, reliefContours: true, reliefStep: 25, reliefContourOpacity: 55 } },
]);

/* ---------- Малые помощники ---------- */

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Отложенный аргумент: считается в момент вызова метода, после всех предыдущих записей канвы
// (так путь строится, а отсутствующая фабрика путей срабатывает в том же месте рисования, что и раньше).
class Late {
  constructor(make) {
    this.make = make;
  }
}

const late = (make) => new Late(make);

// Для проигрывателя рисования: шаг — объект (присваивания свойств по порядку ключей), массив [метод, ...аргументы],
// функция (вызов на месте) или пустое значение (пропуск).
const play = (target, steps) => {
  for (const step of steps) {
    if (!step) continue;
    if (typeof step === "function") step();
    else if (Array.isArray(step)) target[step[0]](...step.slice(1).map((arg) => (arg instanceof Late ? arg.make() : arg)));
    else Object.assign(target, step);
  }
};

const scoped = (target, steps) => {
  target.save();
  play(target, steps);
  target.restore();
};

/* ---------- Вид рельефа ---------- */

const LUMA = [0.2126, 0.7152, 0.0722];

const lightness = (hex) => hexToRgb(hex).reduce((total, channel, at) => total + LUMA[at] * channel, 0) / 255;

const stepToward = (channel, target, share) => channel + (target - channel) * share;

const mix = (left, right, share) => {
  const [from, to] = [hexToRgb(left), hexToRgb(right)];
  return rgbToHex(from.map((channel, at) => stepToward(channel, to[at], share)));
};

const percentOf = (value, fallback) => clamp(Number(value ?? fallback), 0, 100) / 100;

const wrapDegrees = (angle) => ((angle % 360) + 360) % 360;

// Цвет «верха» по яркости суши: светлой суше — к коричневому, тёмной — к белому; линии — к чёрному или белому.
const HIGH_BLEND = [["#6b5236", 0.55], ["#ffffff", 0.42]];
const CONTOUR_POLE = ["#000000", "#ffffff"];

// Поля вида по порядку; каждое считается из общей сводки env.
const STYLE_FIELDS = [
  ["dark", (env) => env.dark],
  ["shade", (env) => env.shade],
  ["light", ({ opts }) => wrapDegrees(Number(opts.reliefLight ?? 315))],
  ["height", ({ opts }) => clamp(Number(opts.reliefHeight ?? 100) / 100, 0.3, 4)],
  ["tint", (env) => env.tint],
  ["low", ({ opts, land }) => opts.reliefLow || land],
  ["high", ({ opts, land, dark }) => opts.reliefHigh || mix(land, ...HIGH_BLEND[Number(dark)])],
  ["contours", (env) => env.contours],
  ["step", ({ opts }) => clamp(Math.round(Number(opts.reliefStep ?? 50)), 10, 200)],
  ["contourColor", ({ opts, land, dark }) => opts.reliefContourColor || mix(land, CONTOUR_POLE[Number(dark)], 0.5)],
  ["contourOpacity", ({ opts }) => percentOf(opts.reliefContourOpacity, 40)],
];

export const terrainStyle = (base, land = "#1d1d1d") => {
  const opts = base || {};
  if (!opts.reliefOn) return null;
  const env = {
    opts,
    land,
    dark: lightness(land) < 0.4,
    shade: percentOf(opts.reliefShade, 55),
    tint: percentOf(opts.reliefTint, 0),
    contours: Boolean(opts.reliefContours),
  };
  if (!(env.shade || env.tint || env.contours)) return null;
  return Object.fromEntries(STYLE_FIELDS.map(([key, make]) => [key, make(env)]));
};

/* ---------- Сетка высот ---------- */

let gridMemo = null;

const bytesOf = (text) => {
  if (typeof atob !== "function") return Uint8Array.from(Buffer.from(text, "base64"));
  const binary = atob(text);
  return Uint8Array.from({ length: binary.length }, (_, at) => binary.charCodeAt(at));
};

// Катмулл — Ром: вложенная запись той же последовательности действий (порядок важен для последнего бита).
const total = (...terms) => terms.reduce((sum, term) => sum + term);

const spline = (p0, p1, p2, p3, t) => {
  const steep = total(3 * (p1 - p2), p3, -p0);
  const bend = total(2 * p0, -5 * p1, 4 * p2, -p3);
  return p1 + 0.5 * t * (p2 - p0 + t * (bend + t * steep));
};

// Соседи клетки с весами: центр 4, стороны 2, углы 1; порядок — строки сверху вниз, внутри слева направо.
const KERNEL = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ dy, dx, weight: (dx !== 0 ? 1 : 2) * (dy !== 0 ? 1 : 2) })));

const soften = (field, width, height) =>
  Float32Array.from(field, (_, at) => {
    const [row, column] = [Math.floor(at / width), at % width];
    const [sum, weight] = KERNEL.reduce(
      (acc, { dy, dx, weight: k }) => {
        const [y, x] = [row + dy, column + dx];
        return y < 0 || x < 0 || y >= height || x >= width ? acc : [acc[0] + field[y * width + x] * k, acc[1] + k];
      },
      [0, 0],
    );
    return sum / weight;
  });

const buildGrid = () => {
  const { width: sourceWidth, height: sourceHeight, data, zmin, zmax } = heights;
  const bytes = bytesOf(data);
  const scale = (zmax - zmin) / 255;
  const source = (column, row) => bytes[clamp(row, 0, sourceHeight - 1) * sourceWidth + clamp(column, 0, sourceWidth - 1)] * scale + zmin;
  const acrossAt = (x1, tx) => (row) => spline(source(x1 - 1, row), source(x1, row), source(x1 + 1, row), source(x1 + 2, row), tx);

  const width = (sourceWidth - 1) * UPSAMPLE + 1;
  const height = (sourceHeight - 1) * UPSAMPLE + 1;
  const dense = Float32Array.from({ length: width * height }, (_, at) => {
    const [x, y] = [(at % width) / UPSAMPLE, Math.floor(at / width) / UPSAMPLE];
    const [x1, y1] = [Math.floor(x), Math.floor(y)];
    const across = acrossAt(x1, x - x1);
    return Math.max(0, spline(across(y1 - 1), across(y1), across(y1 + 1), across(y1 + 2), y - y1));
  });
  const z = Array.from({ length: SOFTEN_PASSES }).reduce((field) => soften(field, width, height), dense);
  return Object.fromEntries([
    ["width", width],
    ["height", height],
    ["x0", heights.x0],
    ["y0", heights.y0],
    ["cell", heights.cell / UPSAMPLE],
    ["z", z],
    ["zmax", zmax],
  ]);
};

export const terrainGrid = () => (gridMemo ??= buildGrid());

const blend = (a, b, t) => a * (1 - t) + b * t;

export const reliefHeightAt = (x, y) => {
  const { width, height, x0, y0, cell, z } = terrainGrid();
  const spot = [(x - x0) / cell, (y - y0) / cell];
  const limits = [width - 1, height - 1];
  if (spot.some((value, axis) => value < 0 || value > limits[axis])) return 0;
  const [column, row] = spot;
  const [c, r] = [Math.floor(column), Math.floor(row)];
  const cellAt = (cc, rr) => z[clamp(rr, 0, height - 1) * width + clamp(cc, 0, width - 1)];
  const lower = blend(cellAt(c, r), cellAt(c + 1, r), column - c);
  const upper = blend(cellAt(c, r + 1), cellAt(c + 1, r + 1), column - c);
  return blend(lower, upper, row - r);
};

/* ---------- Изолинии (метод квадратов) ---------- */

// Рёбра клетки: 0 низ, 1 право, 2 верх, 3 лево. Отрезки каждого случая записаны парами цифр «откуда, куда».
const pairsOf = (code) => Array.from({ length: code.length / 2 }, (_, at) => [Number(code[2 * at]), Number(code[2 * at + 1])]);

const CASE_CODES = ["", "03", "10", "13", "21", "", "20", "23", "32", "02", "", "12", "31", "01", "30", ""];
const SEGMENTS = CASE_CODES.map((code) => pairsOf(code));
// Седловины: [соединённые, раздельные].
const SADDLES = new Map([
  [5, ["0123", "0321"].map((code) => pairsOf(code))],
  [10, ["3012", "1032"].map((code) => pairsOf(code))],
]);

// Ребро -> [буква ключа, сдвиг по столбцу, сдвиг по строке, угол «откуда», угол «куда», горизонтальное ли].
const EDGES = [
  ["h", 0, 0, 0, 1, true],
  ["v", 1, 0, 1, 2, false],
  ["h", 0, 1, 3, 2, true],
  ["v", 0, 0, 0, 3, false],
];

const crossing = (level, from, to) => {
  if (from === -Infinity) return 1;
  return to === -Infinity ? 0 : (level - from) / (to - from);
};

// Клетки в порядке «строка за строкой», включая обрамление в минус одну клетку.
function* squares(width, height) {
  const columns = Math.ceil(width) + 1;
  const rows = Math.ceil(height) + 1;
  if (!(columns > 0 && rows > 0)) return;
  for (let at = 0; at < columns * rows; at += 1) yield [(at % columns) - 1, Math.floor(at / columns) - 1];
}

const caseOf = (quad, level) => quad.reduce((bits, value, bit) => bits | (value >= level ? 1 << bit : 0), 0);

// Среднее конечных углов не меньше порога — седловина «соединённая».
const isJoined = (quad, level) => {
  const [count, sum] = quad.reduce((acc, value) => (Number.isFinite(value) ? [acc[0] + 1, acc[1] + value] : acc), [0, 0]);
  return sum / count >= level;
};

const pairsFor = (index, quad, level) => (SADDLES.has(index) ? SADDLES.get(index)[isJoined(quad, level) ? 0 : 1] : SEGMENTS[index]);

// Ключ ребра; точка на ребре создаётся при первом упоминании.
const noteEdge = (places, edge, [column, row], quad, level) => {
  const [letter, shiftX, shiftY, from, to, horizontal] = EDGES[edge];
  const key = `${letter}${column + shiftX},${row + shiftY}`;
  if (!places.has(key)) {
    const share = crossing(level, quad[from], quad[to]);
    places.set(key, horizontal ? [column + share, row + shiftY] : [column + shiftX, row + share]);
  }
  return key;
};

// Сшивка: идём по цепочке «следующая точка», пока не придём в уже посещённую или в тупик.
const stitch = (links, places) => {
  const seen = new Set();
  function* walk(first) {
    for (let key = first; key !== undefined && !seen.has(key); key = links.get(key)) {
      seen.add(key);
      yield places.get(key);
    }
  }
  return [...links.keys()].map((first) => [...walk(first)]).filter((ring) => ring.length >= 3);
};

export const isoRings = (field, width, height, level) => {
  const inGrid = (column, row) => column >= 0 && row >= 0 && column < width && row < height;
  const valueAt = (column, row) => (inGrid(column, row) ? field[row * width + column] : -Infinity);
  const [links, places] = [new Map(), new Map()];
  for (const spot of squares(width, height)) {
    const [column, row] = spot;
    const quad = [valueAt(column, row), valueAt(column + 1, row), valueAt(column + 1, row + 1), valueAt(column, row + 1)];
    const index = caseOf(quad, level);
    if (index % 15 === 0) continue;
    for (const pair of pairsFor(index, quad, level)) {
      const [start, end] = pair.map((edge) => noteEdge(places, edge, spot, quad, level));
      links.set(start, end);
    }
  }
  return stitch(links, places);
};

/* ---------- Формы рельефа ---------- */

// Память форм: не больше CACHE_LIMIT записей, вытесняется самая давно добавленная.
class RecentMap extends Map {
  set(key, value) {
    super.set(key, value);
    if (this.size > CACHE_LIMIT) this.delete(this.keys().next().value);
    return this;
  }
}

const shapeMemo = new RecentMap();

const toRadians = (degrees) => (degrees * Math.PI) / 180;

// Освещённость склона: ровное место — 0, тень — меньше нуля, свет — больше нуля.
const lightField = (style, { width, height, cell, z }) => {
  const [azimuth, elevation] = [toRadians(style.light), toRadians(45)];
  const [lx, ly, lz] = [Math.sin(azimuth) * Math.cos(elevation), Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)];
  const rise = (low, high) => ((high - low) / (cell * 2)) * style.height;
  return Float32Array.from({ length: width * height }, (_, at) => {
    const [row, column] = [Math.floor(at / width), at % width];
    const dx = rise(z[row * width + Math.max(0, column - 1)], z[row * width + Math.min(width - 1, column + 1)]);
    const dy = rise(z[Math.max(0, row - 1) * width + column], z[Math.min(height - 1, row + 1) * width + column]);
    return (-dx * lx - dy * ly + lz) / Math.hypot(dx, dy, 1) - lz;
  });
};

const gapOf = ([ax, ay], [bx, by]) => Math.hypot(ax - bx, ay - by);

// Прореживание кольца: точка остаётся, если отстоит от последней оставленной не меньше зазора.
const thin = (ring) => {
  const kept = ring.reduce((acc, point) => {
    if (acc.length === 0 || gapOf(point, acc.at(-1)) >= THIN_GAP_CELLS) acc.push(point);
    return acc;
  }, []);
  return kept.length < 3 ? ring : kept;
};

const worldRings = (rings, { x0, y0, cell }) =>
  rings.map((ring) => thin(ring).map(([column, row]) => [x0 + column * cell, y0 + row * cell]));

function* ascend(step, limit) {
  for (let level = step; level < limit; level += step) yield level;
}

const buildShapes = (style) => shapesOn(style, terrainGrid());

const shapesOn = (style, grid) => {
  const { width, height } = grid;
  const ringsAt = (field) => (level) => worldRings(isoRings(field, width, height, level), grid);
  const lit = style.shade > 0 ? lightField(style, grid) : null;
  const dim = lit && lit.map((value) => -value);
  return {
    shadows: lit ? SHADOW_STEPS.map((level) => ringsAt(dim)(level)) : [],
    lights: lit ? LIGHT_STEPS.map((level) => ringsAt(lit)(level)) : [],
    tints: style.tint > 0 ? TINT_STEPS.flatMap((level) => (level < grid.zmax ? [{ level, rings: ringsAt(grid.z)(level) }] : [])) : [],
    contours: style.contours
      ? [...ascend(style.step, grid.zmax)].map((level) => ({
          level,
          index: Math.round(level / style.step) % 5 === 0,
          rings: ringsAt(grid.z)(level),
        }))
      : [],
  };
};

export const terrainShapes = (style) => {
  const key = [style.light, style.height, style.shade > 0, style.tint > 0, style.contours ? style.step : 0].map((part) => `${part}`).join("|");
  if (!shapeMemo.has(key)) shapeMemo.set(key, buildShapes(style));
  return shapeMemo.get(key);
};

/* ---------- Рисование ---------- */

const pathMemo = new WeakMap();

const traceRings = (rings, createPath) => {
  const path = createPath();
  for (const ring of rings) {
    ring.forEach(([x, y], at) => (at === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
  }
  return path;
};

// Один путь на список колец; запоминается по самому списку.
const ringsPath = (rings, createPath) => {
  if (!pathMemo.has(rings)) pathMemo.set(rings, traceRings(rings, createPath));
  return pathMemo.get(rings);
};

const tintSteps = (style, { tints }, pathOf) => {
  if (!(style.tint > 0 && tints.length > 0)) return [];
  const top = tints[tints.length - 1].level || 1;
  return tints.flatMap(({ level, rings }) => [
    { globalAlpha: Math.min(1, style.tint * 0.42), fillStyle: mix(style.low, style.high, Math.min(1, level / top)) },
    ["fill", late(() => pathOf(rings)), "evenodd"],
  ]);
};

const washSteps = (style, { shadows, lights }, pathOf) => {
  if (!(style.shade > 0)) return [];
  const [dimmer, brighter] = style.dark ? [0.11, 0.1] : [0.15, 0.06];
  return [
    ["#000000", style.shade * dimmer, shadows],
    ["#ffffff", style.shade * brighter, lights],
  ].flatMap(([fillStyle, globalAlpha, lists]) => [
    { fillStyle, globalAlpha },
    ...lists.filter((rings) => rings.length > 0).map((rings) => ["fill", late(() => pathOf(rings)), "evenodd"]),
  ]);
};

const contourSteps = (style, { contours }, pathOf, pixel) => {
  if (!style.contours || contours.length === 0) return [];
  const lines = contours
    .filter(({ rings }) => rings.length > 0)
    .flatMap(({ index, rings }) => {
      const [fade, floor, grow] = index ? [1, 3.2, 1.5] : [0.7, 2, 0.8];
      return [{ globalAlpha: style.contourOpacity * fade, lineWidth: Math.max(floor, pixel * grow) }, ["stroke", late(() => pathOf(rings))]];
    });
  return [{ strokeStyle: style.contourColor, lineJoin: "round" }, ...lines];
};

export const paintTerrain = (context, style, { createPath, pixel }) => {
  if (!style) return;
  const shapes = terrainShapes(style);
  const pathOf = (rings) => ringsPath(rings, createPath);
  scoped(context, [
    ...tintSteps(style, shapes, pathOf),
    ...washSteps(style, shapes, pathOf),
    ...contourSteps(style, shapes, pathOf, pixel),
  ]);
};
