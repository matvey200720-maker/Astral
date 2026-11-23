// Координаты большой карты: атлас плиток, перевод мир <-> карта, имена плиток.

const ATLAS_KEYS = ["tileUnits", "columns", "rows", "originX", "originY"];

export const DEFAULT_ATLAS = Object.freeze({
  tileUnits: 4500,
  columns: 2,
  rows: 3,
  originX: -4140,
  originY: 8400,
});

// Как поле доводится до допустимого значения после того, как оно стало конечным числом.
const FIT = {
  tileUnits: (n) => Math.max(1, n),
  columns: (n) => Math.max(1, Math.round(n)),
  rows: (n) => Math.max(1, Math.round(n)),
  originX: (n) => n,
  originY: (n) => n,
};

// Уже нормализованные атласы: повторная нормализация отдаёт тот же объект.
const normalized = new WeakSet();

const finiteOr = (raw, fallback) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const normalizeAtlas = (value) => {
  if (normalized.has(value)) return value;
  const source = value && typeof value === "object" ? value : {};
  const atlas = {};
  for (const key of ATLAS_KEYS) {
    atlas[key] = FIT[key](finiteOr(source[key], DEFAULT_ATLAS[key]));
  }
  normalized.add(atlas);
  return Object.freeze(atlas);
};

export const atlasSize = (atlas = DEFAULT_ATLAS) => {
  const { columns, rows, tileUnits } = normalizeAtlas(atlas);
  return { width: columns * tileUnits, height: rows * tileUnits };
};

export const atlasAspect = (atlas = DEFAULT_ATLAS) => {
  const { width, height } = atlasSize(atlas);
  return width / height;
};

export const worldToMap = (point, atlas = DEFAULT_ATLAS) => {
  const base = normalizeAtlas(atlas);
  const { width, height } = atlasSize(base);
  const x = finiteOr(point?.x, 0);
  const y = finiteOr(point?.y, 0);
  return { u: (x - base.originX) / width, v: (base.originY - y) / height };
};

export const mapToWorld = (point, atlas = DEFAULT_ATLAS) => {
  const base = normalizeAtlas(atlas);
  const { width, height } = atlasSize(base);
  const u = finiteOr(point?.u, 0);
  const v = finiteOr(point?.v, 0);
  return { x: base.originX + u * width, y: base.originY - v * height };
};

export const tileRect = (column, row, atlas = DEFAULT_ATLAS) => {
  const { columns, rows } = normalizeAtlas(atlas);
  return { u: column / columns, v: row / rows, width: 1 / columns, height: 1 / rows };
};

const CODE_0 = 48;
const CODE_9 = 57;
const CODE_UPPER_A = 65;
const CODE_UPPER_Z = 90;

// Слово без учёта регистра, только латинские буквы ASCII.
const isWordAscii = (text, word) => {
  if (text.length !== word.length) return false;
  for (let i = 0; i < word.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= CODE_UPPER_A && code <= CODE_UPPER_Z) code += 32;
    if (code !== word.charCodeAt(i)) return false;
  }
  return true;
};

const isDigitsAscii = (text) => {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < CODE_0 || code > CODE_9) return false;
  }
  return true;
};

// minimap[_sea]_<строка>_<колонка>: на части по «_» получается три или четыре.
export const parseTileName = (value) => {
  const parts = (value ? String(value) : "").trim().split("_");
  const hasLayer = parts.length === 4;
  if (!hasLayer && parts.length !== 3) return null;
  if (!isWordAscii(parts[0], "minimap")) return null;
  if (hasLayer && !isWordAscii(parts[1], "sea")) return null;
  const rowText = parts[parts.length - 2];
  const columnText = parts[parts.length - 1];
  if (!isDigitsAscii(rowText) || !isDigitsAscii(columnText)) return null;
  return {
    layer: hasLayer ? "sea" : "land",
    row: Number(rowText),
    column: Number(columnText),
  };
};

export const tileName = (column, row, layer = "land") =>
  `minimap${layer === "sea" ? "_sea" : ""}_${row}_${column}`;

export const atlasFromTiles = (tiles, options = {}) => {
  const base = normalizeAtlas(options.atlas);
  let columns = 0;
  let rows = 0;
  let found = false;
  for (const tile of Array.isArray(tiles) ? tiles : []) {
    const parsed = parseTileName(tile?.name);
    if (!parsed) continue;
    found = true;
    columns = Math.max(columns, parsed.column + 1);
    rows = Math.max(rows, parsed.row + 1);
  }
  if (!found) return base;
  return normalizeAtlas({
    tileUnits: Math.max(1, finiteOr(options.tileUnits, base.tileUnits)),
    columns,
    rows,
    originX: base.originX,
    originY: base.originY,
  });
};
