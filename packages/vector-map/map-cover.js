// Обложка большой карты: склейка плиток, чистка моря и подложки, края острова,
// вписывание в кадр, подъём гаммой и усреднение по клеткам мозаики.
import { stitchMapPack } from "./map-pack.js";
import { mapClearRim } from "./map-rim.js";

const frozenSize = (width, height) => Object.freeze({ width, height });

export const MAP_COVER = frozenSize(1200, 800);
export const BIG_MAP_COVER = frozenSize(1200, 675);
export const BIG_MAP_GAP = 0.03,
  MAP_UNDERLAY_MAX_HEIGHT = -9,
  MAP_GAMMA_TARGET = 0.42,
  MAP_GAMMA_MAX = 2.6;

// Пороги: прозрачной считается точка с альфой строго меньше SOLID, отсутствующий байт (undefined) — непрозрачный.
const LIMITS = { solid: 128, seaReach: 24, islandReach: 36, islandLine: 0.02 };
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const COVER_DEFAULTS = { width: BIG_MAP_COVER.width, height: BIG_MAP_COVER.height, side: 512, gap: BIG_MAP_GAP, smooth: true };

const orDefault = (value, fallback) => (value === undefined ? fallback : value);
const isClear = (rgba, at) => rgba[at + 3] < LIMITS.solid;
const isFilled = (rgba, at) => LIMITS.solid <= rgba[at + 3];
const offsetOf = (width, x, y) => (y * width + x) * 4;
const rgbAt = (rgba, at) => [rgba[at], rgba[at + 1], rgba[at + 2]];
const blankImage = (width, height) => new Uint8ClampedArray(4 * width * height);
const increment = (counts, i) => {
  counts[i] += 1;
};
const bump = (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1);
// Сумма модулей разностей каналов точки и опорного цвета.
const apart = (rgba, at, base) => base.reduce((sum, v, k) => sum + Math.abs(rgba[at + k] - v), 0);
const writeBytes = (target, at, bytes) =>
  bytes.forEach((value, k) => {
    target[at + k] = value;
  });

// Числа от from пока меньше to с шагом единица; границы читаются как есть (NaN — пусто).
function* counting(from, to) {
  let v = from;
  while (v < to) {
    yield v;
    v += 1;
  }
}

// Обход прямоугольника по строкам сверху вниз: visit(x, y); границы читаются как есть, шаг — единица.
const scan = ([y0, y1], [x0, x1], visit) => {
  let y = y0;
  while (y < y1) {
    let x = x0;
    while (x < x1) {
      visit(x, y);
      x += 1;
    }
    y += 1;
  }
};

const scanSize = (width, height, visit) => scan([0, height], [0, width], visit);

export const mapWithoutUnderlay = (geometry) => {
  const kept = (geometry?.groups || []).filter(({ height }) => height > MAP_UNDERLAY_MAX_HEIGHT);
  return { ...geometry, groups: kept };
};

// Наименьший прямоугольник, накрывающий добавленные точки.
class Extent {
  constructor() {
    this.lo = [Infinity, Infinity];
    this.hi = [-Infinity, -Infinity];
  }

  add(x, y) {
    [x, y].forEach((v, k) => {
      this.lo[k] = Math.min(this.lo[k], v);
      this.hi[k] = Math.max(this.hi[k], v);
    });
  }

  get empty() {
    return this.hi[0] < 0;
  }

  get box() {
    const [x, y] = this.lo;
    return { x, y, width: this.hi[0] - x + 1, height: this.hi[1] - y + 1 };
  }
}

export const mapOpaqueBounds = (rgba, width, height, { alpha = 128 } = {}) => {
  const found = new Extent();
  scanSize(width, height, (x, y) => {
    if (!(rgba[offsetOf(width, x, y) + 3] < alpha)) found.add(x, y);
  });
  return found.empty ? null : found.box;
};

const isNumeral = (text) => text !== "" && [...text].every((ch) => ch >= "0" && ch <= "9");

// Имя плитки «minimap[_sea]_<ряд>_<колонка>.ytd» -> { name, sea, row, column } либо null.
const parseTileName = (leaf) => {
  const lower = leaf.toLowerCase();
  const stem = lower.endsWith(".ytd") ? lower.slice(0, -4) : "";
  const [head, ...rest] = stem.split("_");
  const sea = rest[0] === "sea";
  const numbers = sea ? rest.slice(1) : rest;
  const valid = head === "minimap" && numbers.length === 2 && numbers.every(isNumeral);
  return valid ? { name: stem, sea, row: Number(numbers[0]), column: Number(numbers[1]) } : null;
};

export const mapPackTiles = (files = []) =>
  [...files].flatMap((file) => {
    const tile = parseTileName(String(file?.name || "").split(/[/\\]/).at(-1));
    return tile ? [{ ...tile, bytes: file.bytes }] : [];
  });

// Яркость поля обложки: тёмный фон с мягким светом чуть выше центра.
const fieldLevel = (x, y, width, height) => {
  const offset = (v, size, centre, span) => ((v + 0.5) / size - centre) / span;
  const reach = Math.hypot(offset(x, width, 0.5, 1.2), offset(y, height, 0.38, 0.9));
  const glow = Math.max(0, 1 - reach / 0.64) * 0.07;
  const base = 12 / 255;
  return Math.round((base + glow * (1 - base)) * 255);
};

export const mapCoverField = (width = 1200, height = 800) => {
  const data = blankImage(width, height);
  scanSize(width, height, (x, y) => {
    const level = fieldLevel(x, y, width, height);
    writeBytes(data, offsetOf(width, x, y), [level, level, level, 255]);
  });
  return data;
};

// Вписывание карты в кадр с равным полем по краям: размеры по осям идут парами [ширина, высота].
const fitRect = (mapSize, frame, pad) => {
  const scale = Math.min(...frame.map((side, k) => (side - pad * 2) / mapSize[k]));
  const drawn = mapSize.map((side) => side * scale).map((v) => Math.round(v)).map((v) => Math.max(1, v));
  const [left, top] = frame.map((side, k) => Math.round((side - drawn[k]) / 2));
  return { left, top, width: drawn[0], height: drawn[1], scale };
};

export const mapCoverRect = (mapWidth, mapHeight, width = 1200, height = 800) =>
  fitRect([mapWidth, mapHeight], [width, height], Math.round(height * 0.06));

export const mapIslandRect = (mapWidth, mapHeight, width = 1200, height = 800, gapRatio = 0.12) =>
  fitRect([mapWidth, mapHeight], [width, height], Math.round(height * gapRatio));

const LUMA = [0.2126, 0.7152, 0.0722];

export const mapCoverGamma = (rgba, width, bounds, { target = MAP_GAMMA_TARGET } = {}) => {
  let total = 0;
  let count = 0;
  scan([bounds.y, bounds.y + bounds.height], [bounds.x, bounds.x + bounds.width], (x, y) => {
    const at = offsetOf(width, x, y);
    if (isClear(rgba, at)) return;
    total += LUMA.reduce((sum, weight, k) => sum + weight * rgba[at + k], 0) / 255;
    count += 1;
  });
  const mean = count ? total / count : 1;
  const lifted = () => {
    const [logMean, logTarget] = [mean, target].map((v) => Math.log(v));
    return Math.min(MAP_GAMMA_MAX, logMean / logTarget);
  };
  return mean >= target || mean <= 0 ? 1 : lifted();
};

// Среднее по клетке мозаики: цвет взвешен прозрачностью, четвёртое число — средняя прозрачность по клеткам.
export const mapMosaicBlock = (mosaic, bounds, x, y, step) => {
  const stop = (origin, size, from, shift) => Math.min(origin + size, Math.max(from + 1, Math.ceil(origin + shift + step)));
  const start = [bounds.x + Math.floor(x), bounds.y + Math.floor(y)];
  const rows = [start[1], stop(bounds.y, bounds.height, start[1], y)];
  const cols = [start[0], stop(bounds.x, bounds.width, start[0], x)];
  const sums = [0, 0, 0];
  let weights = 0;
  let cells = 0;
  scan(rows, cols, (sx, sy) => {
    const at = offsetOf(mosaic.width, sx, sy);
    const weight = mosaic.rgba[at + 3];
    sums.forEach((_, k) => {
      sums[k] += mosaic.rgba[at + k] * weight;
    });
    weights += weight;
    cells += 1;
  });
  return weights ? [...sums.map((sum) => sum / weights), weights / cells] : [0, 0, 0, 0];
};

// Точки границы атласа: верх и низ по каждому столбцу, затем бока по средним строкам.
const borderOf = (width, height) => [
  ...Array.from(counting(0, width), (x) => [[x, 0], [x, height - 1]]).flat(),
  ...Array.from(counting(1, height - 1), (y) => [[0, y], [width - 1, y]]).flat(),
];

// Ключ цвета: старшие bits бит каждого канала, склеенные в одно число.
const channelKey = (rgb, bits) => rgb.reduce((key, v) => key * 2 ** bits + (v >> (8 - bits)), 0);

// Цвет, середина клетки ключа: канал · scale + half.
const keyColor = (key, bits) => [2 * bits, bits, 0].map((shift) => ((key >> shift) & (2 ** bits - 1)) * 2 ** (8 - bits) + 2 ** (7 - bits));

function* unwind(stack) {
  while (stack.length) yield stack.pop();
}

export const mapClearSea = (rgba, width, height) => {
  const border = borderOf(width, height);
  const solid = border.map(([x, y]) => offsetOf(width, x, y)).filter((at) => !isClear(rgba, at));
  const tally = new Map();
  solid.forEach((at) => bump(tally, channelKey(rgbAt(rgba, at), 6)));
  const top = [...tally.values()].reduce((best, repeats) => Math.max(best, repeats), 0);
  const dominant = solid.length >= border.length * 0.9 && top >= border.length * 0.8;
  if (!dominant) return false;

  const [seaKey] = Array.from(tally).find(([, count]) => count === top);
  const sea = keyColor(seaKey, 6);
  const isSea = (at) => isFilled(rgba, at) && apart(rgba, at, sea) <= LIMITS.seaReach;

  // Заливка от берегов атласа: достигнутая точка сразу становится прозрачной, её номер уходит в стопку.
  const pending = [];
  const outside = (v, size) => v < 0 || v >= size;
  const claim = (x, y) => {
    const at = offsetOf(width, x, y);
    if (outside(x, width) || outside(y, height) || !isSea(at)) return;
    writeBytes(rgba, at + 3, [0]);
    pending.push(y * width + x);
  };
  border.forEach(([x, y]) => claim(x, y));
  for (const index of unwind(pending)) {
    const x = index % width;
    const y = (index - x) / width;
    NEIGHBORS.forEach(([dx, dy]) => claim(x + dx, y + dy));
  }
  return true;
};

// Первая и последняя позиции, где счётчик набрал порог, либо null.
const reachSpan = (counts, enough) => {
  const first = counts.findIndex((v) => v >= enough);
  return first < 0 ? null : [first, counts.findLastIndex((v) => v >= enough)];
};

// Начало и длина участка по первой и последней позиции.
const runOf = ([first, last]) => [first, last - first + 1];

export const mapIslandBounds = (rgba, width, height) => {
  const shortSide = Math.min(width, height);
  const band = Math.max(1, Math.round(shortSide * 0.04));
  const inBand = (x, y) => x < band || y < band || x >= width - band || y >= height - band;
  const quantized = new Map();
  scanSize(width, height, (x, y) => {
    const at = offsetOf(width, x, y);
    if (inBand(x, y) && !isClear(rgba, at)) bump(quantized, channelKey(rgbAt(rgba, at), 5));
  });
  const [seaKey] = [...quantized].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [-1, 0]);
  const sea = seaKey < 0 ? null : keyColor(seaKey, 5);

  const rows = new Array(height).fill(0);
  const columns = new Array(width).fill(0);
  scanSize(width, height, (x, y) => {
    const at = offsetOf(width, x, y);
    const skipped = isClear(rgba, at) || (sea ? apart(rgba, at, sea) : Infinity) <= LIMITS.islandReach;
    if (!skipped) {
      increment(rows, y);
      increment(columns, x);
    }
  });
  const spans = [reachSpan(columns, height * LIMITS.islandLine), reachSpan(rows, width * LIMITS.islandLine)];
  if (spans.includes(null)) return null;
  const [[x, spanX], [y, spanY]] = spans.map(runOf);
  const tooSmall = [[spanX, width], [spanY, height]].some(([got, whole]) => got < whole / 3);
  return tooSmall ? null : { x, y, width: spanX, height: spanY };
};

// Кривая гаммы: значение канала -> значение после подъёма.
const gammaCurve = (gamma) => {
  const lift = 1 / gamma;
  const units = Array.from(Array(256).keys(), (v) => v / 255);
  return Uint8ClampedArray.from(units, (unit) => Math.round(255 * unit ** lift));
};

// Рамка острова с запасом по краям, не выходящая за мозаику.
const paddedBounds = (island, pad, mosaic) => {
  if (!island) return { x: 0, y: 0, width: mosaic.width, height: mosaic.height };
  const axes = [[island.x, island.width, mosaic.width], [island.y, island.height, mosaic.height]];
  const [[x, width], [y, height]] = axes.map(([origin, size, whole]) => {
    const start = Math.max(0, origin - pad);
    return [start, Math.min(whole, origin + size + pad) - start];
  });
  return { x, y, width, height };
};

// Чистка склейки: море, подложка; остров ищется по краям видимого или по цвету моря.
// `exact` (часть редукса) — карта как в файлах автора: уходит только сплошное море одного цвета от краёв; подложка и всё, что автор нарисовал над
// морем (подписи «ПАЛЕТО», «МАЯК» у GODMODE срезались берегом по высотам), остаётся.
const locateIsland = ({ rgba, width, height }, exact = false) => {
  mapClearSea(rgba, width, height);
  if (exact) return { rimmed: false, island: mapOpaqueBounds(rgba, width, height) || mapIslandBounds(rgba, width, height) };
  const removed = mapClearRim(rgba, width, height);
  const rimmed = removed > 0;
  return { rimmed, island: (rimmed ? mapOpaqueBounds : mapIslandBounds)(rgba, width, height) };
};

// Один пиксель обложки: четыре байта по положению (mx, my) внутри нарисованной карты.
const coverPixel = (plan, mx, my) => {
  const { mosaic, bounds, rect, curve, feather, smooth } = plan;
  const reach = Math.min(...[mx, my, rect.width - 1 - mx, rect.height - 1 - my]);
  const edge = feather ? Math.min(1, reach / feather) : 1;
  const [fx, fy, step] = [mx, my, 1].map((v) => v / rect.scale);
  const sample = smooth ? mapMosaicBlock(mosaic, bounds, fx, fy, step) : null;
  const source = (cell, origin, extent) => origin + Math.min(extent - 1, Math.floor(cell));
  const from = (source(fy, bounds.y, bounds.height) * mosaic.width + source(fx, bounds.x, bounds.width)) * 4;
  const shades = sample ? sample.slice(0, 3).map((v) => Math.round(v)) : rgbAt(mosaic.rgba, from);
  const unit = (sample ? sample[3] : mosaic.rgba[from + 3]) / 255;
  const opacity = [edge, edge, 3 - 2 * edge].reduce((held, factor) => held * factor, unit);
  return [...shades.map((v) => curve[v]), Math.round(opacity * 255)];
};

export const mapPackCover = (files, options = {}) => {
  const settings = Object.fromEntries(
    Object.entries(COVER_DEFAULTS).map(([key, fallback]) => [key, orDefault(options[key], fallback)]),
  );
  const { width, height } = settings;
  const tiles = mapPackTiles(files);
  if (tiles.length === 0) return null;

  const mosaic = stitchMapPack({ tiles }, { side: settings.side, inflateRaw: options.inflateRaw });
  const { rimmed, island } = locateIsland(mosaic, options.exact === true);
  const sizeShare = rimmed ? 0.005 : 0.04;
  const pad = island ? Math.round(Math.max(island.width, island.height) * sizeShare) : 0;
  const bounds = paddedBounds(island, pad, mosaic);
  const rect = mapIslandRect(...[bounds.width, bounds.height, width, height, settings.gap]);
  /* `exact` — цвета как в файлах автора, без подъёма тёмной карты (часть редукса: чёрная карта остаётся чёрной). */
  const curve = gammaCurve(options.exact === true ? 1 : mapCoverGamma(mosaic.rgba, mosaic.width, bounds));
  const feather = island ? Math.max(1, pad * rect.scale) : 0;
  const plan = { mosaic, bounds, rect, curve, feather, smooth: settings.smooth };

  const rgba = blankImage(width, height);
  scan([0, rect.height], [0, rect.width], (mx, my) => {
    const at = [(rect.top + my) * width, rect.left, mx].reduce((sum, v) => sum + v) * 4;
    writeBytes(rgba, at, coverPixel(plan, mx, my));
  });
  return Object.assign({ width, height, rgba }, { rows: mosaic.rows, columns: mosaic.columns });
};
