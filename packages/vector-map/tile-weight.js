import { sceneTileGrid } from "./paint.js";
import { tileName, tileRect, normalizeAtlas } from "./projection.js";
import { MAP_TILE_SIDE_LIMIT, MAP_DETAIL_LEVELS, radarPlan } from "./model.js";

const MEBIBYTE = 1024 * 1024;

export const HEAVY_TILE_BYTES = 32 * MEBIBYTE;
export const HEAVY_VIDEO_BYTES = 160 * MEBIBYTE;

const BYTES_PER_PIXEL = Object.freeze({
  bc1: 0.5,
  bc1a: 0.5,
  bc3: 1,
  rgba8: 4,
});

// Форматы плиток игрока (имя ресурса без D3DFMT_ и в верхнем регистре) → формат файла.
const PLAYER_FORMATS = Object.freeze({
  DXT1: "bc1",
  DXT5: "bc3",
  A8R8G8B8: "rgba8",
});

// Для плиток игрока без своей стороны и без известного формата: штатная сторона и запасной формат.
const STOCK_DEFAULTS = Object.freeze({
  sea: Object.freeze({ side: 1024, format: "bc3" }),
  land: Object.freeze({ side: 512, format: "bc1" }),
});

// Штатные плитки, когда игра не прочитана: [ключ списка в сцене, семья, формат ресурса].
const STOCK_LISTS = [
  ["tiles", "sea", "DXT5"],
  ["landTiles", "land", "DXT1"],
];

const isHeavy = (bytes) => bytes >= HEAVY_VIDEO_BYTES;
const withMipChain = (bytes) => (bytes * 4) / 3;

/* ---------- плитка → описание → байты ---------- */

const ownOrGridSide = (tile, grid) => tile.pixels || grid.pixels;
const specSide = (tile, grid) => Math.min(MAP_TILE_SIDE_LIMIT, ownOrGridSide(tile, grid));

// Поля описания плитки в порядке чтения: сторона, формат, мипы.
const SPEC_FIELDS = [
  ["pixels", specSide],
  ["format", (tile, grid, chosen) => tile.format || chosen],
  ["mipmaps", (tile) => tile.mipmaps ?? true],
];

export const exportTileSpec = (tile, grid, chosen = "bc3") =>
  Object.fromEntries(SPEC_FIELDS.map(([key, pick]) => [key, pick(tile, grid, chosen)]));

export const tileVideoBytes = ({ pixels, format, mipmaps }) => {
  const perPixel = BYTES_PER_PIXEL[format] ?? 1;
  const base = pixels * pixels * perPixel;
  return Math.round(mipmaps ? withMipChain(base) : base);
};

/* ---------- плитки игрока как есть ---------- */

const resourceName = (format) => String(format).replace(/^D3DFMT_/i, "").toUpperCase();

const stockSide = (tile, standard) => (tile.width > 0 ? tile.width : standard.side);

function stockTileBytes(tile, family) {
  const standard = STOCK_DEFAULTS[family];
  const format = PLAYER_FORMATS[resourceName(tile.format)] ?? standard.format;
  return tileVideoBytes({ pixels: stockSide(tile, standard), format, mipmaps: tile.levels > 1 });
}

// Сумма и наибольший вес по списку плиток одной семьи; отсутствующий список — пустой.
function stockTotals(tiles, family) {
  const start = { sum: 0, max: 0 };
  return (tiles || []).reduce((acc, tile) => {
    const bytes = stockTileBytes(tile, family);
    acc.sum += bytes;
    acc.max = Math.max(acc.max, bytes);
    return acc;
  }, start);
}

/* ---------- штатные плитки, когда игра не прочитана ---------- */

function stockLayout(scene) {
  const atlas = normalizeAtlas(scene?.atlas);
  const places = [];
  for (let row = 0; row < atlas.rows; row += 1) {
    for (let column = 0; column < atlas.columns; column += 1) {
      places.push({ column, row, rect: tileRect(column, row, atlas) });
    }
  }
  const layout = { ...scene };
  for (const [key, family, format] of STOCK_LISTS) {
    layout[key] = places.map(({ column, row, rect }) => ({
      name: tileName(column, row, family),
      rect,
      format,
      levels: 1,
      width: STOCK_DEFAULTS[family].side,
      href: null,
    }));
  }
  return layout;
}

/* ---------- вес записанного ---------- */

// Настройки экспорта берутся из проекта как есть, без нормализации; config.export читается первым.
function exportSettings(config) {
  return {
    resolution: config.export?.resolution,
    format: config.export?.format,
    detail: config.export?.detail,
    bare: config.base?.bare,
  };
}

// Одно взвешивание сетки экспорта: вес паузы, радара, их сумма и самая тяжёлая плитка паузы.
function weighGrid(scene, settings, radarMode, detail) {
  const grid = sceneTileGrid(scene, settings.resolution, {
    detail,
    sideLimit: MAP_TILE_SIDE_LIMIT,
    radar: radarMode,
    pauseOpaque: !settings.bare,
  });
  const shared = settings.format === "bc1" ? "bc1" : "bc3";
  const total = grid.tiles.reduce(
    (acc, tile) => {
      const bytes = tileVideoBytes(exportTileSpec(tile, grid, shared));
      const side = tile.family === "land" ? "radar" : "pause";
      acc[side] += bytes;
      if (side === "pause") acc.tile = Math.max(acc.tile, bytes);
      return acc;
    },
    { pause: 0, radar: 0, tile: 0 },
  );
  total.bytes = total.pause + total.radar;
  return total;
}

export const worldMapVideoWeight = (scene, config) => {
  const given = scene?.tiles;
  const assumed = !(Array.isArray(given) && given.length > 0);
  const working = assumed ? stockLayout(scene) : scene;
  const settings = exportSettings(config);
  const radarMode = radarPlan(config).mode;
  const weigh = (detail) => weighGrid(working, settings, radarMode, detail);

  const current = weigh(settings.detail);
  const levels = MAP_DETAIL_LEVELS.map(({ value }) => [value, weigh(value)]);
  const table = (key) => Object.fromEntries(levels.map(([value, weight]) => [value, weight[key]]));
  const seaStock = stockTotals(working.tiles, "sea");
  const landStock = stockTotals(working.landTiles, "land");

  return {
    pause: current.pause,
    radar: current.radar,
    bytes: current.bytes,
    tile: current.tile,
    stock: seaStock.sum + landStock.sum,
    stockTile: seaStock.max,
    byDetail: table("bytes"),
    tileByDetail: table("tile"),
    heavy: isHeavy(current.bytes),
    assumed,
  };
};
