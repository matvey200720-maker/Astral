import { MAP_SCHEMATIC } from "../schematic.js";
import { FONT_FAMILIES, WEIGHTS } from "./text-style.js";
import { alpha, pathFrom, project, round, smoothPath } from "./geometry.js";

export const BASE_RASTER_TOKEN = "astral:base-raster";
export const GRID_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const SLOT_ID = "base-image";
const MIDDLE = "middle";
const CAPTION_LOOK = [FONT_FAMILIES.condensed, WEIGHTS.bold, "#04060a"];

// Фабрики предметов: порядок ключей каждого вида задан здесь и больше нигде.
function disc(id, x, y, r, fill) {
  return { kind: "circle", id, x, y, r, fill, opacity: 0.18 };
}

// Контуры схемы по видам: area — только заливка, line — штрих с круглыми концами, strip — полоса с плоскими концами.
function area(id, d, fill) {
  return { kind: "path", id, d, fill };
}

function ground(id, d, fill, stroke, strokeWidth) {
  return { kind: "path", id, d, fill, stroke, strokeWidth, lineJoin: "round" };
}

function sandbar(id, d, fill) {
  return { kind: "path", id, d, fill, opacity: 0.9 };
}

function ring(id, d, stroke, strokeWidth, opacity) {
  return { kind: "path", id, d, stroke, strokeWidth, opacity, lineJoin: "round", lineCap: "round" };
}

function strip(id, d, stroke, strokeWidth) {
  return { kind: "path", id, d, stroke, strokeWidth, lineCap: "butt" };
}

function line(id, d, stroke, strokeWidth) {
  return { kind: "path", id, d, stroke, strokeWidth, lineCap: "round", lineJoin: "round" };
}

function veil(id, width, height, fill, opacity, blend) {
  return { kind: "rect", id, x: 0, y: 0, width, height, fill, opacity, blend };
}

function picture(id, href, x, y, width, height) {
  return { kind: "image", id, href, x, y, width, height };
}

function lazyPicture(id, href, x, y, width, height) {
  return { kind: "image", id, href, lazy: true, x, y, width, height };
}

function ruling(d, stroke, opacity) {
  return { kind: "path", id: "grid-lines", d, stroke, strokeWidth: 0.7, opacity, lineCap: "butt" };
}

function caption(id, x, y, value, size, fill, opacity, strokeWidth) {
  return {
    kind: "text",
    id,
    x,
    y,
    value,
    size,
    fill,
    opacity,
    family: CAPTION_LOOK[0],
    weight: CAPTION_LOOK[1],
    anchor: MIDDLE,
    baseline: MIDDLE,
    stroke: CAPTION_LOOK[2],
    strokeWidth,
  };
}

const isRasterSlot = (item) => item.id === SLOT_ID && item.href === BASE_RASTER_TOKEN;

// Один флаг «что-то заменено» на всю сцену: после первой замены каждый следующий слой base копируется.
export function withBaseRasterHref(scene, href) {
  if (!(scene && href)) return scene;
  let replaced = false;
  const swapSlot = (item) => {
    if (!isRasterSlot(item)) return item;
    replaced = true;
    return { ...item, href };
  };
  const rebuild = (layer) => {
    const items = layer.items.map(swapSlot);
    return replaced ? { ...layer, items } : layer;
  };
  const layers = scene.layers.map((layer) => (layer.id === "base" ? rebuild(layer) : layer));
  return replaced ? { ...scene, layers } : scene;
}

export function baseImageItem(href, projector) {
  const slot = picture(SLOT_ID, href, 0, 0, projector.width, projector.height);
  return [{ ...slot, preserveAspectRatio: "none" }];
}

const tintVeil = (look, projector) => [
  veil("base-tint", projector.width, projector.height, look.tintColor, alpha(look.tintOpacity), look.tintBlend),
];

export function tintItems(config, projector) {
  const look = config.base;
  return look.tintOpacity ? tintVeil(look, projector) : [];
}

// Схема штата. Каждый вид собирает свои предметы из env; порядок видов — порядок рисования.
const EDGE_STEPS = [5, 4, 3, 2, 1];
const PEAK_RINGS = [3, 2, 1];

// Линейные виды: [список схемы, поле цвета основы, множитель толщины, имя предмета, точки записи].
const RIVERS = ["rivers", "water", 4.2, (_, n) => `river-${n}`, (entry) => entry];
const ROADS = ["roads", "roads", 2.4, (entry) => `road-${entry.id}`, (entry) => entry.points];
const HIGHWAYS = ["highways", "highways", 4.4, (entry) => `highway-${entry.id}`, (entry) => entry.points];

function strokeLines(env, [source, colour, weight, nameOf, pointsOf]) {
  const thickness = round(weight * env.roadScale);
  return MAP_SCHEMATIC[source].map((entry, n) =>
    line(nameOf(entry, n), env.trace(pointsOf(entry), false), env.look[colour], thickness),
  );
}

function glowRings(env) {
  if (!env.glowing) return [];
  const { look, shore } = env;
  return EDGE_STEPS.map((step) =>
    ring(
      `edge-${step}`,
      shore,
      look.edgeGlowColor,
      round(step ** 2 * look.edgeGlow / 90),
      round(0.16 * look.edgeGlow / 100),
    ),
  );
}

function groundShapes(env) {
  const { look, view, shore, trace } = env;
  const sand = (beach) => sandbar(`beach-${beach.id}`, trace(beach.points, true), look.sand);
  const ringsOf = (peak) => {
    const centre = view.point(peak);
    return PEAK_RINGS.map((step) => {
      const r = view.length(peak.radius * step / 3);
      return disc(`peak-${peak.id}-${step}`, centre.x, centre.y, r, look.terrain);
    });
  };
  const land = ground("land", shore, look.land, look.outline, look.outlineWidth);
  return [land].concat(MAP_SCHEMATIC.beaches.map(sand), MAP_SCHEMATIC.peaks.flatMap(ringsOf));
}

function waterShapes(env) {
  const lakes = MAP_SCHEMATIC.water.map((points, n) =>
    area(`water-${n}`, env.trace(points, true), env.look.water),
  );
  return lakes.concat(strokeLines(env, RIVERS));
}

function blockShapes(env) {
  return MAP_SCHEMATIC.urban.map((block) =>
    area(`urban-${block.id}`, env.trace(block.points, true, 0.35), env.look.buildings),
  );
}

function roadShapes(env) {
  const strips = MAP_SCHEMATIC.runways.map((runway) =>
    strip(
      `runway-${runway.id}`,
      pathFrom(project(env.view, runway.points), false),
      env.look.runway,
      env.view.length(runway.width),
    ),
  );
  return strips.concat(strokeLines(env, ROADS), strokeLines(env, HIGHWAYS));
}

// [слой, который скрывает вид; сборка вида]
const STAGES = [
  ["land", glowRings],
  ["land", groundShapes],
  ["water", waterShapes],
  ["buildings", blockShapes],
  ["roads", roadShapes],
];

// Окружение сборки: проектор, «мировые точки → путь», путь берега, масштаб дорог
// и признак ореола (в порядке чтений основы).
function schematicEnv(look, projector) {
  const trace = (points, closed, tension) => smoothPath(project(projector, points), closed, tension);
  const shore = trace(MAP_SCHEMATIC.coastline, true);
  return { look, view: projector, trace, shore, roadScale: look.roadWidth / 100, glowing: look.edgeGlow > 0 };
}

export function schematicItems(config, projector) {
  const look = config.base;
  const hidden = new Set(look.hidden || []);
  const env = schematicEnv(look, projector);
  return STAGES.reduce((items, [layer, build]) => (hidden.has(layer) ? items : items.concat(build(env))), []);
}

// Сетка координат.
const between = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Линии одного направления: n-я лежит на round(n * cell), пока n меньше числа клеток.
function ruled(count, cell, segment) {
  let out = "";
  for (let n = 1; n < count; n++) out += segment(round(n * cell));
  return out;
}

function columnName(n) {
  if (n < 26) return GRID_LETTERS[n];
  const first = GRID_LETTERS[Math.floor(n / 26) - 1];
  return `${first}${GRID_LETTERS[n % 26]}`;
}

// Размер подписи и отступ номера первого ряда под букву первой колонки.
function captionMetrics(cell, percent) {
  const natural = between(cell * 0.4, 8, 22);
  const size = round(Math.min(natural * (percent / 100), Math.max(cell * 0.6, natural)));
  return { size, corner: Math.max(0, 1.7 * size - 0.5 * cell) };
}

const rowCount = (height, cell) => Math.max(1, Math.ceil(height / cell));

function laidGrid(look, projector) {
  const columns = look.gridStep;
  const frame = [projector.width, projector.height];
  const cell = frame[0] / columns;
  const rows = rowCount(frame[1], cell);
  const down = (at) => `M${at} 0L${at} ${frame[1]}`;
  const across = (at) => `M0 ${at}L${frame[0]} ${at}`;
  const lines = ruled(columns, cell, down) + ruled(rows, cell, across);
  const items = [ruling(lines, look.gridColor, alpha(look.gridOpacity))];
  if (!look.gridLabels) return items;

  const { size, corner } = captionMetrics(cell, look.gridLabelSize);
  const halo = round(size / 9);
  // Подписи колонок лежат сверху (y = size * 0.8), подписи рядов слева (x = size * 0.8); первый ряд сдвинут на corner.
  for (let pass = 0; pass < 2; pass++) {
    const byRow = pass === 1;
    const count = byRow ? rows : columns;
    for (let n = 0; n < count; n++) {
      const along = (n + 0.5) * cell;
      const fill = look.gridLabelColor || look.gridColor;
      const opacity = alpha(Math.min(100, look.gridOpacity + 30));
      if (byRow) {
        const y = round(along + (n === 0 ? corner : 0));
        items.push(caption(`grid-row-${n}`, round(size * 0.8), y, String(n + 1), size, fill, opacity, halo));
      } else {
        const x = round(along);
        items.push(caption(`grid-column-${n}`, x, round(size * 0.8), columnName(n), size, fill, opacity, halo));
      }
    }
  }
  return items;
}

export function gridItems(config, projector) {
  const look = config.base;
  return look.gridOpacity ? laidGrid(look, projector) : [];
}

// Плитки: берутся те, у которых есть адрес и доли rect; доля умножается на размер проектора и округляется.
const fit = (ratio, extent) => round(ratio * extent);

function drawable(tiles, make) {
  const found = [];
  for (const entry of tiles) {
    if (entry?.href) {
      if (entry.rect) found.push(make(entry));
    }
  }
  return found;
}

export function tileItems(tiles, projector) {
  return drawable(tiles, (tile) =>
    picture(
      `tile-${tile.name}`,
      tile.href,
      fit(tile.rect.u, projector.width),
      fit(tile.rect.v, projector.height),
      fit(tile.rect.width, projector.width),
      fit(tile.rect.height, projector.height),
    ),
  );
}

export function templateTileItems(tiles, projector) {
  return drawable(tiles, (tile) =>
    lazyPicture(
      `template-${tile.row}-${tile.column}`,
      tile.href,
      fit(tile.rect.u, projector.width),
      fit(tile.rect.v, projector.height),
      fit(tile.rect.width, projector.width),
      fit(tile.rect.height, projector.height),
    ),
  );
}
