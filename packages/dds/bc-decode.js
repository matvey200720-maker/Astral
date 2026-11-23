// Декодеры BC7, BC4 (ATI1), BC5 (ATI2) и несжатых форматов: байты уровня без заголовка DDS → RGBA.

// Веса интерполяции по числу бит индекса.
const WEIGHTS = Object.fromEntries(
  [
    "2 | 0 21 43 64",
    "3 | 0 9 18 27 37 46 55 64",
    "4 | 0 4 9 13 17 21 26 30 34 38 43 47 51 55 60 64",
  ].map((row) => {
    const [bits, list] = row.split(" | ");
    return [bits, list.split(" ").map(Number)];
  }),
);

// Параметры режимов BC7; поля: ns — подмножества, pb — биты разбиения, rb — поворот, isb — выбор индекса,
// cb — биты цвета, ab — биты альфы, epb/spb — p-бит на точку/на подмножество, ib и ib2 — биты индексов.
const MODE_FIELDS = ["mode","ns","pb","rb","isb","cb","ab","epb","spb","ib","ib2"];
const MODES = `
  0 3 4 0 0 4 0 1 0 3 0
  1 2 6 0 0 6 0 0 1 3 0
  2 3 6 0 0 5 0 0 0 2 0
  3 2 6 0 0 7 0 1 0 2 0
  4 1 0 2 1 5 6 0 0 2 3
  5 1 0 2 0 7 8 0 0 2 2
  6 1 0 0 0 7 7 1 0 4 0
  7 2 6 0 0 5 5 1 0 2 0
`
  .trim()
  .split("\n")
  .map((row) => Object.fromEntries(row.trim().split(" ").map((value, at) => [MODE_FIELDS[at], Number(value)])));

// Таблицы разбиений: строка — один вариант разбиения, цифра — подмножество пикселя (по порядку 4×4).
const readRows = (table) => table.trim().split("\n").map((row) => Array.from(row.trim(), Number));

const PARTITION2 = readRows(`
  0011001100110011
  0001000100010001
  0111011101110111
  0001001100110111
  0000000100010011
  0011011101111111
  0001001101111111
  0000000100110111
  0000000000010011
  0011011111111111
  0000000101111111
  0000000000010111
  0001011111111111
  0000000011111111
  0000111111111111
  0000000000001111
  0000100011101111
  0111000100000000
  0000000010001110
  0111001100010000
  0011000100000000
  0000100011001110
  0000000010001100
  0111001100110001
  0011000100010000
  0000100010001100
  0110011001100110
  0011011001101100
  0001011111101000
  0000111111110000
  0111000110001110
  0011100110011100
  0101010101010101
  0000111100001111
  0101101001011010
  0011001111001100
  0011110000111100
  0101010110101010
  0110100101101001
  0101101010100101
  0111001111001110
  0001001111001000
  0011001001001100
  0011101111011100
  0110100110010110
  0011110011000011
  0110011010011001
  0000011001100000
  0100111001000000
  0010011100100000
  0000001001110010
  0000010011100100
  0110110010010011
  0011011011001001
  0110001110011100
  0011100111000110
  0110110011001001
  0110001100111001
  0111111010000001
  0001100011100111
  0000111100110011
  0011001111110000
  0010001011101110
  0100010001110111
`);

const PARTITION3 = readRows(`
  0011001102212222
  0001001122112221
  0000200122112211
  0222002200110111
  0000000011221122
  0011001100220022
  0022002211111111
  0011001122112211
  0000000011112222
  0000111111112222
  0000111122222222
  0012001200120012
  0112011201120112
  0122012201220122
  0011011211221222
  0011200122002220
  0001001101121122
  0111001120012200
  0000112211221122
  0022002200221111
  0111011102220222
  0001000122212221
  0000001101220122
  0000110022102210
  0122012200110000
  0012001211222222
  0110122112210110
  0000011012211221
  0022110211020022
  0110011020022222
  0011012201220011
  0000200022112221
  0000000211221222
  0222002200120011
  0011001200220222
  0120012001200120
  0000111122220000
  0120120120120120
  0120201212010120
  0011220011220011
  0011112222000011
  0101010122222222
  0000000021212121
  0022112200221122
  0022001100220011
  0220122102201221
  0101222222220101
  0000212121212121
  0101010101012222
  0222011102220111
  0002111200021112
  0000211221122112
  0222011101110222
  0002111211120002
  0110011001102222
  0000000021122112
  0110011022222222
  0022001100110022
  0022112211220022
  0000000000002112
  0002000100020001
  0222122202221222
  0101222222222222
  0111201122012220
`);

const numbers = (line) => line.split(" ").map(Number);
const ANCHOR2 = numbers("15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 2 8 2 2 8 8 15 2 8 2 2 8 8 2 2 15 15 6 8 2 8 15 15 2 8 2 2 2 15 15 6 6 2 6 8 15 15 2 2 15 15 15 15 15 2 2 15");
const ANCHOR3_1 = numbers("3 3 15 15 8 3 15 15 8 8 6 6 6 5 3 3 3 3 8 15 3 3 6 10 5 8 8 6 8 5 15 15 8 15 3 5 6 10 8 15 15 3 15 5 15 15 15 15 3 15 5 5 5 8 5 10 5 10 8 13 15 12 3 3");
const ANCHOR3_2 = numbers("15 8 8 3 15 15 3 8 15 15 15 15 15 15 15 8 15 8 15 3 15 8 15 8 3 15 6 10 15 15 10 8 15 3 15 10 10 8 9 10 6 15 8 15 3 6 6 8 15 3 15 15 15 15 15 15 15 15 15 15 3 15 15 8");

const PARTITIONS = { 2: PARTITION2, 3: PARTITION3 };
const ANCHORS = { 2: [ANCHOR2], 3: [ANCHOR3_1, ANCHOR3_2] };

// Обход сетки блоков 4×4: decodeBlock заполняет block (16 пикселей RGBA), края картинки обрезаются.
const placeBlock = (out, block, [bx, by], width, height) => {
  for (let p = 0; p < 16; p += 1) {
    const x = bx * 4 + (p % 4);
    const y = by * 4 + Math.floor(p / 4);
    if (!(x < width && y < height)) continue;
    out.set(block.subarray(p * 4, p * 4 + 4), (y * width + x) * 4);
  }
};

const decodeGrid = (decodeBlock, blockSize, data, width, height) => {
  const out = new Uint8ClampedArray(width * height * 4);
  const [cols, rows] = [width, height].map((size) => Math.max(1, Math.ceil(size / 4)));
  const block = new Uint8ClampedArray(64);
  for (let n = 0; n < rows * cols; n += 1) {
    decodeBlock(data, n * blockSize, block);
    placeBlock(out, block, [n % cols, Math.floor(n / cols)], width, height);
  }
  return out;
};

// Бит с позиции pos блока (с младшего бита байта 0).
const bitAt = (data, base, pos) => ((data[base + (pos >> 3)] & 0xff) >> (pos & 7)) & 1;

// Читатель битов блока: поле собирается с младшего бита значения.
const bitReader = (data, base) => {
  let pos = 0;
  return (count) => {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value |= bitAt(data, base, pos) << i;
      pos += 1;
    }
    return value;
  };
};

const widen = (v, bits) => {
  if (bits >= 8) return v;
  return (v << (8 - bits)) | (v >> (2 * bits - 8));
};
const mix = (e0, e1, w) => {
  const sum = e0 * (64 - w) + e1 * w + 32;
  return sum >> 6;
};

const decodeBc7Block = (data, base, block) => {
  const lead = data[base] & 0xff;
  if (lead === 0) return block.fill(0);
  const mode = 31 - Math.clz32(lead & -lead);
  const spec = MODES[mode];
  const { ns, ib, ib2 } = spec;
  const take = bitReader(data, base);
  take(mode + 1);
  const partition = take(spec.pb);
  const rotation = take(spec.rb);
  const selector = take(spec.isb);

  const count = ns * 2;
  const perPoint = (bits) => Array.from({ length: count }, () => take(bits));
  const colors = [0, 1, 2].map(() => perPoint(spec.cb));
  const alpha = spec.ab ? perPoint(spec.ab) : new Array(count).fill(255);
  const channels = [...colors, alpha];

  if (spec.epb) {
    const tinted = channels.slice(0, spec.ab ? 4 : 3);
    for (let i = 0; i < count; i += 1) {
      const p = take(1);
      for (const points of tinted) points[i] = points[i] * 2 + p;
    }
  } else if (spec.spb) {
    for (let s = 0; s < ns; s += 1) {
      const p = take(1);
      for (const points of colors) {
        for (const i of [2 * s, 2 * s + 1]) points[i] = points[i] * 2 + p;
      }
    }
  }
  const colorBits = spec.cb + (spec.epb | spec.spb);
  const precision = [colorBits, colorBits, colorBits, spec.ab && spec.ab + spec.epb];
  for (let c = 0; c < channels.length; c += 1) {
    if (!precision[c]) continue;
    const points = channels[c];
    for (let i = 0; i < points.length; i += 1) points[i] = widen(points[i], precision[c]);
  }

  const anchors = [0, ...(ANCHORS[ns] ?? []).map((table) => table[partition])];
  const readIndices = (bits, fixed) =>
    Array.from({ length: 16 }, (_, p) => take(bits - Number(fixed.includes(p))));
  const primary = readIndices(ib, anchors);
  const secondary = ib2 ? readIndices(ib2, [0]) : null;
  const primarySource = [primary, ib];
  const secondarySource = [secondary, ib2];
  let [colorSource, alphaSource] = [primarySource, primarySource];
  if (secondary) {
    [colorSource, alphaSource] = selector ? [secondarySource, primarySource] : [primarySource, secondarySource];
  }

  for (let p = 0; p < 16; p += 1) {
    const s = ns === 1 ? 0 : PARTITIONS[ns][partition][p];
    const px = channels.map((points, c) => {
      const [indices, bits] = c === 3 ? alphaSource : colorSource;
      return mix(points[2 * s], points[2 * s + 1], WEIGHTS[bits][indices[p]]);
    });
    if (rotation) {
      const kept = px[rotation - 1];
      px[rotation - 1] = px[3];
      px[3] = kept;
    }
    block.set(px, p * 4);
  }
  return block;
};

// Канал BC4: 16 значений из блока в 8 байт.
const bc4Palette = (e0, e1) => {
  const [divisor, tail] = e0 > e1 ? [7, []] : [5, [0, 255]];
  const mids = Array.from({ length: divisor - 1 }, (_, i) =>
    Math.round(((divisor - 1 - i) * e0 + (i + 1) * e1) / divisor),
  );
  return [e0, e1, ...mids, ...tail];
};

const bc4Values = (data, at) => {
  const palette = bc4Palette(data[at], data[at + 1]);
  let bits = 0n;
  for (let k = 7; k >= 2; k -= 1) bits = (bits << 8n) | BigInt(data[at + k]);
  return Array.from({ length: 16 }, (_, p) => palette[Number((bits >> BigInt(3 * p)) & 7n)]);
};

const decodeBc4Block = (data, at, block) => {
  const values = bc4Values(data, at);
  for (let p = 0; p < values.length; p += 1) block.set([values[p], values[p], values[p], 255], p * 4);
};

const decodeBc5Block = (data, at, block) => {
  const reds = bc4Values(data, at);
  const greens = bc4Values(data, at + 8);
  for (let p = 0; p < reds.length; p += 1) {
    const [r, g] = [reds[p], greens[p]];
    const [x, y] = [r / 127.5 - 1, g / 127.5 - 1];
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    block.set([r, g, Math.round((z + 1) * 127.5), 255], p * 4);
  }
};

export const decodeBc7 = (data, width, height) => decodeGrid(decodeBc7Block, 16, data, width, height);
export const decodeBc4 = (data, width, height) => decodeGrid(decodeBc4Block, 8, data, width, height);
export const decodeBc5 = (data, width, height) => decodeGrid(decodeBc5Block, 16, data, width, height);

// Несжатые: stride — позиций входа на пиксель, put пишет один пиксель в out с позиции o.
const bgra = (fixedAlpha) => ({
  stride: 4,
  put: (out, o, data, i) => {
    for (let to = 0; to < 3; to += 1) out[o + to] = data[i + 2 - to];
    out[o + 3] = fixedAlpha ?? data[i + 3];
  },
});

const LAYOUTS = new Map(
  Object.entries({
    A8: { stride: 1, put: (out, o, data, i) => out.set([255, 255, 255, data[i]], o) },
    L8: { stride: 1, put: (out, o, data, i) => out.set([data[i], data[i], data[i], 255], o) },
    A8B8G8R8: { stride: 4, put: (out, o, data, i) => out.set(data.subarray(i, i + 4), o) },
    X8R8G8B8: bgra(255),
  }),
);
const DEFAULT_LAYOUT = bgra();

export const decodeUncompressed = (format, data, width, height) => {
  const out = new Uint8ClampedArray(width * height * 4);
  const layout = LAYOUTS.get(format) ?? DEFAULT_LAYOUT;
  for (let n = 0; n < width * height; n += 1) layout.put(out, n * 4, data, n * layout.stride);
  return out;
};
