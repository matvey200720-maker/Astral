import { paintLine, paintColour, paintBox, isGradientPaint } from "./effect-paint.js";
import { upscaleFactorFor } from "./upscale.js";
import { tileRect, tileName, normalizeAtlas } from "./projection.js";

const TAU = Math.PI * 2;
const NO_FILTER = "none";
const BADGE_HALF = 0.72;
const BADGE_ROUND = 0.34;
const CURVE_PAD = 0.08;
const BLUR_REACH = 3;

export const PAUSE_TILE_FORMAT = "bc1";
const DXT_FORMATS = Object.freeze({
  D3DFMT_DXT1: "bc1",
  D3DFMT_DXT5: "bc3",
  DXT1: "bc1",
  DXT5: "bc3",
  D3DFMT_A8R8G8B8: "rgba8",
  A8R8G8B8: "rgba8",
});
export const RADAR_TILE_SIDE_PLAIN = 1024;
export const PAUSE_CLEAR_TILE_FORMAT = "bc1a";
export const RADAR_TILE_SIDE_LIMIT = 2048;

const given = (value) => value !== undefined && value !== null;
const numberOr = (value, fallback) => Number(value) || fallback;
const sideOf = (tile, fallback) => (tile.width > 0 ? tile.width : fallback);
const hasStroke = (item) => item.stroke && item.strokeWidth > 0;

/* ---------- раскладка плиток экспорта ---------- */

// Сторона плитки по разрешению карты: степень двойки, не меньше 256.
function sideByResolution(resolution, columns) {
  const power = Math.floor(Math.log2(Math.max(1, resolution / columns)));
  return Math.max(256, 2 ** power);
}

// Порядок чтений виден по ошибкам: параметры, затем атлас, затем размеры сцены.
function readGridSettings(scene, resolution, options) {
  const detail = numberOr(options.detail, 1);
  const sideLimit = numberOr(options.sideLimit, 4096);
  const opaque = options.pauseOpaque !== false;
  const atlas = normalizeAtlas(scene.atlas);
  const cellWidth = scene.width / atlas.columns;
  const cellHeight = scene.height / atlas.rows;
  const pixels = sideByResolution(resolution, atlas.columns);
  return { detail, sideLimit, opaque, atlas, cellWidth, cellHeight, pixels };
}

// Заводская сетка (игра не прочитана): только семья паузы, по строкам сверху вниз.
function seaTilesOf({ atlas, cellWidth, cellHeight, pixels, opaque }) {
  const tiles = [];
  let row = 0;
  while (row < atlas.rows) {
    for (let column = 0; column < atlas.columns; column += 1) {
      const name = tileName(column, row, "sea");
      const tile = { name, file: `${name}.ytd`, family: "sea", column, row, pixels, mipmaps: true };
      if (opaque) {
        tile.format = PAUSE_TILE_FORMAT;
        tile.opaque = true;
      }
      tile.rect = tileRect(column, row, atlas);
      tile.view = { x: column * cellWidth, y: row * cellHeight, width: cellWidth, height: cellHeight };
      tiles.push(tile);
    }
    row += 1;
  }
  return tiles;
}

const pauseSideOf = (tile, { pixels, detail, sideLimit }) => {
  const side = sideOf(tile, pixels);
  return side * upscaleFactorFor(side, detail, sideLimit);
};

// Сторона плиток радара: только в режиме «карта» и только при плитках игрока.
function radarSideOf(mode, known, settings) {
  if (mode !== "map") return 0;
  let biggest = -Infinity;
  for (const tile of known) biggest = Math.max(biggest, pauseSideOf(tile, settings));
  return Math.min(settings.sideLimit, RADAR_TILE_SIDE_PLAIN, biggest);
}

const columnOf = (rect, atlas) => Math.round(rect.u * atlas.columns);
const rowOf = (rect, atlas) => Math.round(rect.v * atlas.rows);

const viewOf = (rect, scene) => ({
  x: rect.u * scene.width,
  y: rect.v * scene.height,
  width: rect.width * scene.width,
  height: rect.height * scene.height,
});

// Плитка паузы игрока: сторона берётся первой (width читается раньше rect).
function pauseEntry(scene, settings, tile) {
  const { atlas, opaque } = settings;
  const side = sideOf(tile, settings.pixels);
  const factor = upscaleFactorFor(side, settings.detail, settings.sideLimit);
  const { rect } = tile;
  const format = opaque ? PAUSE_TILE_FORMAT : PAUSE_CLEAR_TILE_FORMAT;
  const entry = { name: tile.name, file: `${tile.name}.ytd`, format };
  if (opaque) entry.opaque = true;
  entry.mipmaps = true;
  entry.column = columnOf(rect, atlas);
  entry.row = rowOf(rect, atlas);
  entry.pixels = side * factor;
  entry.sourcePixels = side;
  entry.factor = factor;
  entry.rect = rect;
  entry.view = viewOf(rect, scene);
  entry.family = "sea";
  return entry;
}

// Плитка радара: href читается первым, формат — по таблице имён ресурса, множитель — дробный.
function radarEntry(scene, settings, radarSide, tile) {
  const underlay = tile.href || null;
  const side = sideOf(tile, settings.pixels);
  const factor = radarSide > side ? radarSide / side : 1;
  const { rect } = tile;
  return {
    name: tile.name,
    file: `${tile.name}.ytd`,
    format: DXT_FORMATS[String(tile.format || "").toUpperCase()] ?? null,
    mipmaps: factor > 1 || (tile.levels ? tile.levels > 1 : null),
    column: columnOf(rect, settings.atlas),
    row: rowOf(rect, settings.atlas),
    pixels: side * factor,
    sourcePixels: side,
    factor,
    rect,
    view: viewOf(rect, scene),
    family: "land",
    underlay,
  };
}

export const sceneTileGrid = (scene, resolution = 4096, options = {}) => {
  const settings = readGridSettings(scene, resolution, options);
  const { atlas, pixels } = settings;
  const known = Array.isArray(scene.tiles) ? scene.tiles : [];
  if (known.length === 0) return { tiles: seaTilesOf(settings), pixels, atlas };

  const radarSide = radarSideOf(options.radar, known, settings);
  const landTiles = Array.isArray(scene.landTiles) ? scene.landTiles : [];
  const tiles = [];
  for (const tile of known) tiles.push(pauseEntry(scene, settings, tile));
  for (const tile of landTiles) tiles.push(radarEntry(scene, settings, radarSide, tile));
  return { pixels, atlas, tiles };
};

/* ---------- временные слои ---------- */

function newCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") return null;
  return Object.assign(document.createElement("canvas"), { width, height });
}

// Холст-слой с контекстом; null, если нет ни OffscreenCanvas, ни document, ни контекста.
function makeLayer(width, height) {
  const canvas = newCanvas(width, height);
  const ctx = canvas?.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

function stampTint(ctx, picture, colour, width, height) {
  ctx.drawImage(picture, 0, 0, width, height);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, width, height);
}

const tintCache = new WeakMap();

function tintedCopy(picture, colour) {
  const cached = tintCache.get(picture)?.get(colour);
  if (cached) return cached;
  const width = picture.width || picture.naturalWidth;
  const height = picture.height || picture.naturalHeight;
  const layer = width && height ? makeLayer(width, height) : null;
  if (layer === null) return picture;
  stampTint(layer.ctx, picture, colour, width, height);
  tintCache.set(picture, (tintCache.get(picture) ?? new Map()).set(colour, layer.canvas));
  return layer.canvas;
}

/* ---------- краска и общие шаги рисования ---------- */

const clampUnit = (value) => Math.min(1, Math.max(0, value));

function gradientFor(ctx, paint, box) {
  const line = paintLine(paint, box);
  const gradient = ctx.createLinearGradient(line.x1, line.y1, line.x2, line.y2);
  const { stops } = paint;
  let n = 0;
  while (n < stops.length) {
    gradient.addColorStop(clampUnit(stops[n][0]), stops[n][1]);
    n += 1;
  }
  return gradient;
}

const resolvePaint = (ctx, paint, box) => {
  if (!isGradientPaint(paint)) return paint;
  return typeof ctx.createLinearGradient === "function" ? gradientFor(ctx, paint, box) : paintColour(paint);
};

const dimBy = (ctx, factor) => {
  ctx.globalAlpha *= factor;
};

const undimBy = (ctx, factor) => {
  ctx.globalAlpha /= factor;
};

const setInk = (ctx, style, width) => {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
};

const setEnds = (ctx, join, cap) => {
  ctx.lineJoin = join;
  ctx.lineCap = cap;
};

// Вокруг точки: сдвиг в неё, действие, сдвиг обратно (вертикальный возврат задаётся отдельно).
const aroundPoint = (ctx, px, py, backY, act, arg) => {
  ctx.translate(px, py);
  act(ctx, arg);
  ctx.translate(-px, backY);
};
const rotateBy = (ctx, angle) => ctx.rotate(angle);
const mirrorX = (ctx) => ctx.scale(-1, 1);

// Контур и заливка прямоугольника: со скруглением или без.
const traceRect = (ctx, rounded, x, y, width, height, radius) => {
  if (rounded) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
};

const fillRectShape = (ctx, rounded, x, y, width, height, radius) => {
  if (!rounded) {
    ctx.fillRect(x, y, width, height);
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
};

const canRound = (ctx, radius) => radius > 0 && typeof ctx.roundRect === "function";
const floodShape = (ctx, path, style) => {
  ctx.fillStyle = style;
  ctx.fill(path);
};

/* ---------- виды предметов ---------- */

function paintRect(ctx, item) {
  const box = paintBox(item);
  const rounded = canRound(ctx, item.radius);
  const { x, y, width, height, radius } = item;
  if (item.fill) {
    ctx.fillStyle = resolvePaint(ctx, item.fill, box);
    fillRectShape(ctx, rounded, x, y, width, height, radius);
  }
  if (hasStroke(item)) {
    ctx.beginPath();
    traceRect(ctx, rounded, x, y, width, height, radius);
    setInk(ctx, resolvePaint(ctx, item.stroke, box), item.strokeWidth);
    ctx.stroke();
  }
}

function fillPath(ctx, item, path) {
  const share = item.fillOpacity ?? 1;
  dimBy(ctx, share);
  floodShape(ctx, path, item.fill);
  undimBy(ctx, share);
}

function strokeClipped(ctx, path) {
  ctx.save();
  ctx.clip(path);
  ctx.stroke(path);
  ctx.restore();
}

function strokePath(ctx, item, path) {
  dimBy(ctx, item.strokeOpacity ?? 1);
  setInk(ctx, item.stroke, item.strokeWidth);
  setEnds(ctx, item.lineJoin || "miter", item.lineCap || "butt");
  if (item.dash) ctx.setLineDash(item.dash);
  if (item.clip) strokeClipped(ctx, path);
  else ctx.stroke(path);
}

function paintPath(ctx, item) {
  const path = new Path2D(item.d);
  if (item.fill) fillPath(ctx, item, path);
  if (hasStroke(item)) strokePath(ctx, item, path);
}

const circlePath = (ctx, { x, y, r }) => {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
};

function strokeCircle(ctx, item, box) {
  dimBy(ctx, item.strokeOpacity ?? 1);
  setInk(ctx, resolvePaint(ctx, item.stroke, box), item.strokeWidth);
  if (item.dash) ctx.setLineDash(item.dash);
  ctx.stroke();
}

function paintCircle(ctx, item) {
  const box = paintBox(item);
  circlePath(ctx, item);
  if (item.fill) {
    const style = resolvePaint(ctx, item.fill, box);
    ctx.fillStyle = style;
    ctx.fill();
  }
  if (hasStroke(item)) strokeCircle(ctx, item, box);
}

// Значок с плашкой при прозрачности рисуется на своём слое: плашка и контур не просвечивают друг сквозь друга.
const badgeLayerSide = (ctx, span) => Math.max(2, Math.ceil(span * (Math.abs(ctx.getTransform().a) || 1)));

function buildBadgeLayer(ctx, item) {
  const half = item.size * BADGE_HALF;
  const span = half * 2;
  const side = badgeLayerSide(ctx, span);
  const layer = makeLayer(side, side);
  if (layer !== null) {
    layer.ctx.scale(side / span, side / span);
    layer.ctx.translate(half - item.x, half - item.y);
  }
  return layer;
}

const openBadgeLayer = (ctx, item) =>
  typeof ctx.getTransform === "function" ? buildBadgeLayer(ctx, item) : null;
const needsPlateLayer = (ctx, item) => item.badge && ctx.globalAlpha < 1;

function drawPlate(target, item) {
  const { x, y, size } = item;
  const half = size * BADGE_HALF;
  target.fillStyle = item.badge.fill;
  target.beginPath();
  const rounded = typeof target.roundRect === "function";
  traceRect(target, rounded, x - half, y - half, half * 2, half * 2, size * BADGE_ROUND);
  target.fill();
}

function outlineGlyph(target, item, path, box, zoom) {
  setInk(target, resolvePaint(target, item.stroke, box), item.strokeWidth / zoom);
  setEnds(target, "round", "round");
  target.stroke(path);
}

function drawGlyph(target, item) {
  if (item.badge) drawPlate(target, item);
  const zoom = item.size / item.box;
  target.translate(item.x - item.size / 2, item.y - item.size / 2);
  target.scale(zoom, zoom);
  const path = new Path2D(item.path);
  const box = paintBox(item);
  if (hasStroke(item)) outlineGlyph(target, item, path, box, zoom);
  floodShape(target, path, resolvePaint(target, item.fill, box));
}

function paintGlyph(ctx, item) {
  const layer = needsPlateLayer(ctx, item) ? openBadgeLayer(ctx, item) : null;
  drawGlyph(layer === null ? ctx : layer.ctx, item);
  if (layer === null) return;
  const half = item.size * BADGE_HALF;
  ctx.drawImage(layer.canvas, item.x - half, item.y - half, half * 2, half * 2);
}

const findImage = (images, href) => images?.get?.(href) || images?.[href];

function drawCover(ctx, picture, item, naturalWidth, naturalHeight) {
  const { x, y, width, height } = item;
  const frameRatio = width / height;
  const sourceWide = naturalWidth / naturalHeight > frameRatio;
  const cutWidth = sourceWide ? naturalHeight * frameRatio : naturalWidth;
  const cutHeight = sourceWide ? naturalHeight : naturalWidth / frameRatio;
  const left = (naturalWidth - cutWidth) / 2;
  const top = (naturalHeight - cutHeight) / 2;
  ctx.drawImage(picture, left, top, cutWidth, cutHeight, x, y, width, height);
}

function drawContain(ctx, picture, item, naturalWidth, naturalHeight) {
  const { x, y, width, height } = item;
  const sourceRatio = naturalWidth / naturalHeight;
  const sourceWide = sourceRatio > width / height;
  const drawWidth = sourceWide ? width : height * sourceRatio;
  const drawHeight = sourceWide ? width / sourceRatio : height;
  ctx.drawImage(picture, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

const clipRounded = (ctx, x, y, width, height, radius) => {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.clip();
};

const naturalSide = (picture, item, key, alt) => picture[key] || picture[alt] || item[key];

function paintImage(ctx, item, images) {
  const found = findImage(images, item.href);
  if (!found) return;
  const picture = item.tint ? tintedCopy(found, item.tint) : found;
  const naturalWidth = naturalSide(picture, item, "width", "naturalWidth");
  const naturalHeight = naturalSide(picture, item, "height", "naturalHeight");
  const { x, y, width, height, radius } = item;
  if (canRound(ctx, radius)) clipRounded(ctx, x, y, width, height, radius);
  const keepsShape = naturalWidth && naturalHeight && item.preserveAspectRatio !== "none";
  if (!keepsShape) ctx.drawImage(picture, x, y, width, height);
  else if (item.fit === "cover") drawCover(ctx, picture, item, naturalWidth, naturalHeight);
  else drawContain(ctx, picture, item, naturalWidth, naturalHeight);
}

/* ---------- текст ---------- */

const fontOf = (item, px) => `${item.weight || 400} ${px}px ${item.family}`;
const alignOf = (anchor) => (anchor === "middle" ? "center" : anchor || "left");
const manyLines = (item) => (item.lines?.length > 1 ? Array.from(item.lines) : null);

const spreadStep = (wanted, width, glyphs) => (wanted - width) / (glyphs - 1);
const fittedSize = (base, wanted, width) => Math.max(1, (base * wanted) / width);

// Разрядка до заданной ширины; результат — сдвиг по x, null — разрядка не сработала.
function spreadOut(ctx, item, spaced) {
  const { width } = ctx.measureText(item.value);
  const glyphs = Array.from(String(item.value)).length;
  if (!(width > 0 && glyphs > 1 && spaced)) return null;
  const step = spreadStep(item.fitSpacing, width, glyphs);
  ctx.letterSpacing = `${step}px`;
  return item.anchor === "middle" ? step / 2 : 0;
}

function fitToWidth(ctx, item, base, tracking, spaced) {
  const { width } = ctx.measureText(item.value);
  if (!(width > 0)) return;
  const fitted = fittedSize(base, item.fitWidth, width);
  ctx.font = fontOf(item, fitted);
  if (spaced) ctx.letterSpacing = `${(tracking * fitted) / base}px`;
}

// Подгонка под заданную ширину: сначала разрядка, если не вышло — размер шрифта; результат — сдвиг по x.
function fitText(ctx, item, base, tracking, spaced) {
  const shift = item.fitSpacing ? spreadOut(ctx, item, spaced) : null;
  if (shift !== null) return shift;
  if (item.fitWidth) fitToWidth(ctx, item, base, tracking, spaced);
  return 0;
}

// Печать строк: список строк, если он есть, иначе одна строка value.
function strokeRows(ctx, item, rows, x, top, gap) {
  const count = rows ? rows.length : 1;
  for (let n = 0; n < count; n += 1) ctx.strokeText(rows ? rows[n] : item.value, x, top + n * gap);
}

function fillRows(ctx, item, rows, x, top, gap) {
  const count = rows ? rows.length : 1;
  for (let n = 0; n < count; n += 1) ctx.fillText(rows ? rows[n] : item.value, x, top + n * gap);
}

function drawRows(ctx, item, x) {
  const rows = manyLines(item);
  const gap = item.lineStep || 0;
  const top = item.y - (((rows ? rows.length : 1) - 1) / 2) * gap;
  if (hasStroke(item)) {
    setInk(ctx, item.stroke, item.strokeWidth * 2);
    ctx.lineJoin = "round";
    strokeRows(ctx, item, rows, x, top, gap);
  }
  ctx.fillStyle = item.fill;
  fillRows(ctx, item, rows, x, top, gap);
}

function paintText(ctx, item) {
  const base = item.size || 12;
  const tracking = item.letterSpacing || 0;
  const spaced = "letterSpacing" in ctx;
  ctx.font = fontOf(item, base);
  ctx.textAlign = alignOf(item.anchor);
  ctx.textBaseline = item.baseline || "alphabetic";
  if (spaced) ctx.letterSpacing = `${tracking}px`;
  const shift = fitText(ctx, item, base, tracking, spaced);
  drawRows(ctx, item, item.x + shift);
}

const PAINTERS = new Map([
  ["image", paintImage],
  ["text", paintText],
  ["glyph", paintGlyph],
  ["circle", paintCircle],
  ["path", paintPath],
  ["rect", paintRect],
]);

/* ---------- один предмет ---------- */

// Свечение и поворот вынесены в маленькие шаги: порядок вызовов канвы в них важен.
const glowWith = (ctx, glow, scale) => {
  ctx.shadowColor = glow.color;
  ctx.shadowBlur = glow.size * scale;
};

const spinAround = (ctx, item) => {
  const pivot = item.origin || item;
  aroundPoint(ctx, pivot.x, pivot.y, -pivot.y, rotateBy, (item.rotation * Math.PI) / 180);
};

// Общая подготовка: прозрачность, размытие, смешение, свечение, поворот, отражение — строго в этом порядке.
function prepareItem(ctx, item, scale) {
  if (given(item.opacity)) dimBy(ctx, item.opacity);
  if (item.blur) ctx.filter = `blur(${item.blur * scale}px)`;
  if (item.blend) ctx.globalCompositeOperation = item.blend;
  if (item.glow) glowWith(ctx, item.glow, scale);
  if (item.rotation) spinAround(ctx, item);
  if (item.flip) aroundPoint(ctx, item.x + (item.width || 0) / 2, 0, 0, mirrorX);
}

export const paintSceneItem = (context, item, images, scale = 1) => {
  context.save();
  prepareItem(context, item, scale);
  PAINTERS.get(item.kind)?.(context, item, images);
  context.restore();
};

/* ---------- сцена целиком ---------- */

// Отрезок [low, low + size] пересекает [from, from + extent] строго: касание не считается.
const spans = (low, size, from, extent) => low < from + extent && low + size > from;
const overlaps = (box, view) =>
  spans(box.x, box.width, view.x, view.width) && spans(box.y, box.height, view.y, view.height);

const triple = (value) => (value || 0) * BLUR_REACH;
const lowEdge = (origin, spread, curve) => origin - spread - curve;
const wideSpan = (extent, spread, curve) => extent + (spread + curve) * 2;
const reachSpread = (item, blur) => Math.max(item.strokeWidth || 0, triple(blur), triple(item.glow?.size));
const curveOf = (bounds) => Math.max(bounds.width, bounds.height) * CURVE_PAD;

// Рамка охвата предмета: запас на линию, размытие, свечение и сглаженный контур.
function reachOf(item, bounds, blur) {
  const spread = reachSpread(item, blur);
  const curve = curveOf(bounds);
  return {
    x: lowEdge(bounds.x, spread, curve),
    y: lowEdge(bounds.y, spread, curve),
    width: wideSpan(bounds.width, spread, curve),
    height: wideSpan(bounds.height, spread, curve),
  };
}

// То же пересечение с куском, но без создания рамки: так проверяется каждый предмет.
function reachHits(item, bounds, blur, view) {
  const spread = reachSpread(item, blur);
  const curve = curveOf(bounds);
  return (
    spans(lowEdge(bounds.x, spread, curve), wideSpan(bounds.width, spread, curve), view.x, view.width) &&
    spans(lowEdge(bounds.y, spread, curve), wideSpan(bounds.height, spread, curve), view.y, view.height)
  );
}

const edgesOf = ({ x, y, width, height }) => ({ left: x, top: y, right: x + width, bottom: y + height });

const clampTo = (edges, { x, y, width, height }, margin) => ({
  left: Math.max(edges.left, x - margin),
  top: Math.max(edges.top, y - margin),
  right: Math.min(edges.right, x + width + margin),
  bottom: Math.min(edges.bottom, y + height + margin),
});

const mergeEdges = (one, two) => ({
  left: Math.min(one.left, two.left),
  top: Math.min(one.top, two.top),
  right: Math.max(one.right, two.right),
  bottom: Math.max(one.bottom, two.bottom),
});
const NOTHING = Object.freeze({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

const readMatrix = (context) => (typeof context.getTransform === "function" ? context.getTransform() : null);
const isAxisAligned = (matrix) => (matrix ? !(matrix.b || matrix.c) : false);

const pixelSpan = (zoom, shift, from, to) => [Math.floor(zoom * from + shift), Math.ceil(zoom * to + shift)];

// Временный холст под рамку в пикселях основной канвы; null, если места нет или слой не создаётся.
function openBlurLayer({ a, d, e, f }, edges) {
  const [x0, x1] = pixelSpan(a, e, edges.left, edges.right);
  const [y0, y1] = pixelSpan(d, f, edges.top, edges.bottom);
  if (!(x1 > x0 && y1 > y0)) return null;
  const layer = makeLayer(x1 - x0, y1 - y0);
  if (layer) layer.ctx.setTransform(a, 0, 0, d, e - x0, f - y0);
  return layer && { ...layer, x0, y0 };
}

const blurCss = (filter, px) => (filter === NO_FILTER ? `blur(${px}px)` : `${filter} blur(${px}px)`);

function blitBlurred(context, { canvas, x0, y0 }, filter, blurPx, blend) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.filter = blurCss(filter, blurPx);
  if (blend) context.globalCompositeOperation = blend;
  context.drawImage(canvas, x0, y0);
  context.restore();
}

const unblurred = (item) => ({ ...item, blur: 0, blend: null });

function paintBlurredShape(frame, filter, item, reach) {
  const { context, view, scale, images } = frame;
  const matrix = readMatrix(context);
  const area = clampTo(edgesOf(reach), view, (item.blur || 0) * BLUR_REACH);
  const roomy = area.right > area.left && area.bottom > area.top;
  const layer = isAxisAligned(matrix) && roomy ? openBlurLayer(matrix, area) : null;
  if (layer === null) {
    paintSceneItem(context, item, images, scale);
    return;
  }
  paintSceneItem(layer.ctx, unblurred(item), images, scale);
  blitBlurred(context, layer, filter, item.blur * scale, item.blend);
}

// Предметы слоя, попадающие в кусок, с их охватом (слой размывается целиком — берётся его размытие).
function visibleIn(layer, view) {
  const found = [];
  for (const item of layer.items) {
    const reach = item.bounds ? reachOf(item, item.bounds, layer.blur) : view;
    if (overlaps(reach, view)) found.push({ item, edges: edgesOf(reach) });
  }
  return found;
}

// Слой с общим размытием: true — нарисован целиком (или рисовать нечего), false — рисовать предметы по одному.
function paintBlurredGroup(frame, layer, filter) {
  const { context, view, scale, images } = frame;
  const matrix = readMatrix(context);
  if (!isAxisAligned(matrix)) return false;
  const found = visibleIn(layer, view);
  if (found.length === 0) return true;
  const hull = found.reduce((sum, { edges }) => mergeEdges(sum, edges), NOTHING);
  const surface = openBlurLayer(matrix, clampTo(hull, view, layer.blur * BLUR_REACH));
  if (surface === null) return false;
  for (const { item } of found) paintSceneItem(surface.ctx, item, images, scale);
  blitBlurred(context, surface, filter, layer.blur * scale, null);
  return true;
}

function paintItems(frame, layer, filter) {
  const { context, view, scale, images } = frame;
  for (const item of layer.items) {
    const bounds = item.bounds;
    if (bounds && !reachHits(item, bounds, item.blur, view)) continue;
    if (bounds && item.blur > 0 && !item.rotation) {
      paintBlurredShape(frame, filter, item, reachOf(item, bounds, item.blur));
    } else {
      paintSceneItem(context, item, images, scale);
    }
  }
}

const layerFilter = (layer) => (layer.filter && layer.filter !== NO_FILTER ? layer.filter : NO_FILTER);

function paintLayer(frame, layer) {
  const { context } = frame;
  context.save();
  const filter = layerFilter(layer);
  context.filter = filter;
  const done = layer.blur > 0 && paintBlurredGroup(frame, layer, filter);
  if (!done) paintItems(frame, layer, filter);
  context.restore();
}

const wholeScene = (scene) => ({ x: 0, y: 0, width: scene.width, height: scene.height });

// Холст сцены: очистка, масштаб куска и сдвиг в его начало.
function openScene(context, view, size, scale) {
  context.save();
  context.clearRect(0, 0, size.width, size.height);
  context.scale(scale, size.height / view.height);
  context.translate(-view.x, -view.y);
}

export const paintMapScene = (context, scene, options = {}) => {
  const view = options.view || wholeScene(scene);
  const size = { width: options.width || view.width, height: options.height || view.height };
  const only = options.layers ? new Set(options.layers) : null;
  const frame = { context, view, scale: size.width / view.width, images: options.images };

  openScene(context, view, size, frame.scale);
  for (const layer of scene.layers) {
    if (only === null || only.has(layer.id)) paintLayer(frame, layer);
  }
  context.restore();
};
