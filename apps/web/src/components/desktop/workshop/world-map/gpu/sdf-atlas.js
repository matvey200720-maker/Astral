import { signedDistanceField } from "./sdf-field.js";

const COVERAGE_THRESHOLD = 128;
const METRIC_KEYS = ["advance", "bearingX", "bearingY", "width", "height"];

const zeros = (...keys) => Object.fromEntries(keys.map((key) => [key, 0]));

// Запись пустого глифа собирается из трёх частей; порядок ключей: advance, смещения, empty, uv.
const NO_BEARINGS = zeros("bearingX", "bearingY", "width", "height");
const NO_UV = zeros("u0", "v0", "u1", "v1");

// Умолчание только для undefined: null остаётся null (как у значений параметров по умолчанию).
const orDefault = (value, fallback) => (value === undefined ? fallback : value);

const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source[key]]));

const blankEntry = (advance) => Object.assign({ advance }, NO_BEARINGS, { empty: true }, NO_UV);

const hasInk = ({ width, height }) => width > 0 && height > 0;
const overflows = ({ width, height }, margin, cell) =>
  width + margin > cell || height + margin > cell;

// Что делать с ответом растеризатора: пропустить, записать как пустой, отвергнуть или разместить.
const verdictOf = (raster, margin, cell) => {
  if (!raster) return "skip";
  if (!hasInk(raster)) return "blank";
  return overflows(raster, margin, cell) ? "oversize" : "place";
};

const VERDICT_ACTIONS = {
  skip: () => {},
  blank: ({ glyphs }, char, raster) => glyphs.set(char, blankEntry(raster.advance)),
  place: ({ waiting }, char, raster) => waiting.push([char, raster]),
  oversize: ({ cell, radius }, char, raster) => {
    const size = `${raster.width}×${raster.height}`;
    throw new RangeError(`Глиф «${char}» ${size} не входит в ячейку ${cell} с полем ${radius}`);
  },
};

function sortOutGlyphs({ chars, rasterize, cell, radius, glyphs }) {
  const sorting = { cell, radius, glyphs, waiting: [] };
  const margin = radius * 2;
  const pending = new Set(chars ?? []).values();
  for (let step = pending.next(); !step.done; step = pending.next()) {
    const raster = rasterize(step.value);
    VERDICT_ACTIONS[verdictOf(raster, margin, cell)](sorting, step.value, raster);
  }
  return sorting.waiting;
}

// Маска ячейки cell × cell: глиф сдвинут на поле, единица там, где покрытие не ниже порога.
function paintMask(mask, raster, cell, radius) {
  const { width, height, alpha } = raster;
  mask.fill(0);
  let y = 0;
  while (y < height) {
    const target = (y + radius) * cell + radius;
    const source = y * width;
    let x = 0;
    while (x < width) {
      mask[target + x] = Number(alpha[source + x] >= COVERAGE_THRESHOLD);
      x += 1;
    }
    y += 1;
  }
}

// Поле расстояний переносится в ячейку атласа строка за строкой.
function copyField(data, field, cell, width, row, column) {
  const left = column * cell;
  let line = 0;
  while (line < cell) {
    const span = [line * cell, (line + 1) * cell];
    data.set(field.subarray(...span), (row * cell + line) * width + left);
    line += 1;
  }
}

// Границы ячейки целиком в долях атласа по одной оси.
const fractions = (index, cell, total) => [(index * cell) / total, ((index + 1) * cell) / total];

function placedEntry(raster, column, row, cell, [width, height]) {
  const [u0, u1] = fractions(column, cell, width);
  const [v0, v1] = fractions(row, cell, height);
  return Object.assign(pick(raster, METRIC_KEYS), { empty: false }, { u0, v0, u1, v1 });
}

const scratchMask = (count, cell) => (count > 0 ? new Uint8Array(cell * cell) : null);

export const buildSdfAtlas = ({ chars, rasterize, cell, radius, columns, fontSize }) => {
  const side = orDefault(cell, 40);
  const field = orDefault(radius, 6);
  const perRow = orDefault(columns, 16);
  const glyphs = new Map();
  const waiting = sortOutGlyphs({ chars, rasterize, cell: side, radius: field, glyphs });

  const rows = Math.max(Math.ceil(waiting.length / perRow), 1);
  const size = [perRow * side, rows * side];
  const data = new Uint8Array(size[0] * size[1]);

  const mask = scratchMask(waiting.length, side);
  for (const [slot, [char, raster]] of waiting.entries()) {
    const column = slot % perRow;
    const row = Math.floor(slot / perRow);
    paintMask(mask, raster, side, field);
    copyField(data, signedDistanceField(mask, side, side, field), side, size[0], row, column);
    glyphs.set(char, placedEntry(raster, column, row, side, size));
  }

  const atlas = { width: size[0], height: size[1] };
  atlas.cell = side;
  atlas.radius = field;
  atlas.fontSize = orDefault(fontSize, 64);
  atlas.data = data;
  atlas.glyphs = glyphs;
  return atlas;
};
