// Атлас значков и квады для instanced-рисования: [x0, y0, x1, y1, u0, v0, u1, v1, r, g, b, a].
const NO_TINT = [];
const TINT_CHANNELS = [0, 1, 2, 3];
const FALLBACK_COLUMNS = 8;

export const ICON_STRIDE = 12;

const widest = (best, side) => Math.max(best, side);
const sideOf = (icon) => [icon.width, icon.height].reduce(widest);

// Ячейка по умолчанию: наибольшая сторона среди значков, но не меньше единицы.
const longestSide = (icons) => icons.map(sideOf).reduce(widest, 1);

// Сетка ячеек: размер атласа в пикселях при заданном числе значков.
function gridOf(count, columns, side) {
  const rows = Math.max(Math.ceil(count / columns), 1);
  return { width: side * columns, height: side * rows };
}

const cornerOf = (slot, columns, side) => ({
  left: side * (slot % columns),
  top: side * Math.floor(slot / columns),
});

// Доля атласа по одной оси: [начало, конец] занятой части ячейки.
const fractions = (start, length, total) => [start / total, (start + length) / total];

function assertFits(icon, side) {
  if (side < icon.width || side < icon.height) {
    throw new RangeError(`Значок «${icon.id}» больше ячейки ${side}`);
  }
}

// Строки значка переносятся целиком: по одному set на строку, а не по пикселю.
function paintRows(data, icon, atlasWidth, { left, top }) {
  const rowBytes = icon.width * 4;
  let line = 0;
  while (line < icon.height) {
    const begin = line * rowBytes;
    const row = icon.pixels.subarray(begin, begin + rowBytes);
    data.set(row, 4 * ((top + line) * atlasWidth + left));
    line += 1;
  }
}

function tableEntry(icon, corner, grid) {
  const { width, height } = icon;
  const [u0, u1] = fractions(corner.left, width, grid.width);
  const [v0, v1] = fractions(corner.top, height, grid.height);
  return { width, height, u0, v0, u1, v1 };
}

export function buildIconAtlas(icons, { cell, columns = FALLBACK_COLUMNS } = {}) {
  const side = cell ? cell : longestSide(icons);
  const grid = gridOf(icons.length, columns, side);
  const data = new Uint8Array(4 * grid.width * grid.height);

  const placed = icons.map((icon, slot) => {
    assertFits(icon, side);
    const corner = cornerOf(slot, columns, side);
    paintRows(data, icon, grid.width, corner);
    return [icon.id, tableEntry(icon, corner, grid)];
  });

  return Object.assign(grid, { cell: side }, { data, icons: new Map(placed) });
}

const tintOf = (placement) => {
  const tint = placement.colour ?? NO_TINT;
  return TINT_CHANNELS.map((channel) => tint[channel] ?? 1);
};

function quadOf(placement, icon) {
  const scale = placement.scale ?? 1;
  const { x, y } = placement;
  const box = [x, y, x + icon.width * scale, y + icon.height * scale];
  const { u0, v0, u1, v1 } = icon;
  return box.concat([u0, v0, u1, v1], tintOf(placement));
}

const iconOf = (atlas, placement) => atlas.icons.get(placement.id);

export function iconInstances(placements, atlas) {
  const quads = [];
  for (const placement of placements) {
    const icon = iconOf(atlas, placement);
    if (icon !== undefined) quads.push(quadOf(placement, icon));
  }
  return { data: Float32Array.from(quads.flat()), count: quads.length };
}
