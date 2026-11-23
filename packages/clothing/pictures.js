// Операции над готовой картинкой { width, height, rgba }: уменьшение, цвет образца,
// самый частый цвет и признак шахматки-заглушки.

const SWATCH_SIDE = 96;
const CHECKER_SIDE = 32;
const OPAQUE_FROM = 128;

export function shrink(picture, size) {
  const { width, height, rgba } = picture;
  const scale = Math.min(size / Math.max(width, height), 1);
  const newWidth = Math.max(1, Math.round(width * scale));
  const newHeight = Math.max(1, Math.round(height * scale));
  if (newWidth === width && newHeight === height) return { width, height, rgba };

  const out = new Uint8ClampedArray(newWidth * newHeight * 4);
  const columns = Array.from({ length: newWidth }, (_, x) =>
    Math.min(Math.floor(((x + 0.5) * width) / newWidth), width - 1));
  for (let y = 0; y < newHeight; y++) {
    const row = Math.min(Math.floor(((y + 0.5) * height) / newHeight), height - 1);
    for (let x = 0; x < newWidth; x++) {
      const from = (row * width + columns[x]) * 4;
      out.set(rgba.subarray(from, from + 4), (y * newWidth + x) * 4);
    }
  }
  return { width: newWidth, height: newHeight, rgba: out };
}

// Непрозрачные пиксели уменьшенной копии; пиксель без четвёртой величины непрозрачен.
function* opaquePixels(picture, side) {
  const { rgba } = shrink(picture, side);
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    if (rgba[i + 3] < OPAQUE_FROM) continue;
    yield [rgba[i], rgba[i + 1], rgba[i + 2]];
  }
}

// Корзины цвета по старшим битам канала; победитель — самая людная, при равенстве первая.
class ColourBins {
  constructor(bits) {
    this.bits = bits;
    this.drop = 8 - bits;
    this.cells = new Map();
    this.count = 0;
  }

  add(r, g, b) {
    const { bits, drop } = this;
    const key = ((r >> drop) << (2 * bits)) | ((g >> drop) << bits) | (b >> drop);
    const cell = this.cells.get(key);
    if (cell) {
      cell.n++;
      cell.sum[0] += r;
      cell.sum[1] += g;
      cell.sum[2] += b;
    } else {
      this.cells.set(key, { n: 1, sum: [r, g, b] });
    }
    this.count++;
  }

  winner() {
    let best = null;
    for (const cell of this.cells.values()) {
      if (!best || cell.n > best.n) best = cell;
    }
    return best && best.sum.map((total) => Math.round(total / best.n));
  }
}

const toHex = (rgb) => rgb && `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function isSaturated(r, g, b) {
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  return hi >= 40 && (hi - lo) / hi >= 0.35;
}

export function swatchColour(picture) {
  const accent = new ColourBins(3);
  const common = new ColourBins(4);
  let opaque = 0;
  for (const [r, g, b] of opaquePixels(picture, SWATCH_SIDE)) {
    opaque++;
    common.add(r, g, b);
    if (isSaturated(r, g, b)) accent.add(r, g, b);
  }
  // доля насыщенных не меньше 4 % (в целых: насыщенные × 25 ≥ непрозрачные)
  if (opaque > 0 && accent.count * 25 >= opaque) return toHex(accent.winner());
  return toHex(common.winner());
}

export function dominantColour(picture) {
  const bins = new ColourBins(4);
  for (const [r, g, b] of opaquePixels(picture, SWATCH_SIDE)) bins.add(r, g, b);
  return toHex(bins.winner());
}

const isGrey = (cell) => Math.max(...cell.idx) - Math.min(...cell.idx) <= 1;
const brightness = (cell) => cell.idx[0] + cell.idx[1] + cell.idx[2];

export function looksLikeChecker(picture) {
  const { width, height, rgba } = shrink(picture, CHECKER_SIDE);
  const total = width * height;

  const shades = new Map();
  for (let p = 0; p < total; p++) {
    const idx = [rgba[p * 4] >> 5, rgba[p * 4 + 1] >> 5, rgba[p * 4 + 2] >> 5];
    const key = (idx[0] << 6) | (idx[1] << 3) | idx[2];
    const cell = shades.get(key);
    if (cell) cell.n++;
    else shades.set(key, { n: 1, idx });
  }
  if (shades.size < 2) return false;

  const ranked = [...shades.values()].sort((a, b) => b.n - a.n);
  const [first, second] = ranked;
  const main = first.n + second.n;
  const greyShare = ranked.reduce((sum, cell) => (isGrey(cell) ? sum + cell.n : sum), 0);

  // «размытая» заглушка: серые краски разной яркости и почти всё изображение серое
  const blurred =
    main * 4 >= total * 3 &&
    second.n * 5 >= total &&
    isGrey(first) &&
    isGrey(second) &&
    Math.abs(brightness(first) - brightness(second)) >= 9 &&
    greyShare * 100 >= total * 97;
  if (!blurred && (main * 100 < total * 95 || second.n * 5 < total)) return false;

  const threshold = blurred ? 60 : 90;
  const pairs = height * (width - 1);
  let jumps = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const diff =
        Math.abs(rgba[i] - rgba[i + 4]) +
        Math.abs(rgba[i + 1] - rgba[i + 5]) +
        Math.abs(rgba[i + 2] - rgba[i + 6]);
      if (diff > threshold) jumps++;
    }
  }
  return pairs > 0 && jumps * 100 > pairs * 6;
}
