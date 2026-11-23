// Растры DefineBitsLossless / DefineBitsLossless2 → RGBA с прямой альфой
// (как показывает Scaleform игры, а не как велит спецификация SWF).
import { unzlibSync } from "fflate";
import { SwfReader } from "./bits.js";
import { TAG } from "./file.js";

const MAX_SIDE = 4096;
const TRUNCATED = "GFX: растр обрезан.";

const alignTo4 = (n) => (n + 3) & ~3;

// 5 бит канала → байт: v · 255 / 31 с отбрасыванием дроби (так пишет Uint8Array).
const FIVE_TO_EIGHT = Uint8Array.from({ length: 32 }, (_, v) => (v * 255) / 31);

// Раскладка распакованных данных: `prefix` байт перед строками, `stride` — шаг строки,
// `row()` переписывает одну строку в RGBA.

// Формат 3: таблица цветов (RGB или RGBA у Lossless2), строки индексов, выровненные до 4 байт.
class PaletteRows {
  constructor(width, colors, lossless2) {
    this.colors = colors;
    this.entry = lossless2 ? 4 : 3;
    this.prefix = colors * this.entry;
    this.stride = alignTo4(width);
    this.palette = null;
  }

  prepare(data) {
    const { colors, entry } = this;
    const palette = new Uint8Array(colors * 4);
    for (let i = 0, from = 0; i < colors; i++, from += entry) {
      palette[i * 4] = data[from];
      palette[i * 4 + 1] = data[from + 1];
      palette[i * 4 + 2] = data[from + 2];
      palette[i * 4 + 3] = entry === 4 ? data[from + 3] : 255;
    }
    this.palette = palette;
  }

  row(data, from, rgba, to, width) {
    const { palette, colors } = this;
    for (let x = 0; x < width; x++, to += 4) {
      const index = data[from + x];
      // Индекс за таблицей — прозрачный пиксель: выход уже в нулях.
      if (index >= colors) continue;
      const p = index * 4;
      rgba[to] = palette[p];
      rgba[to + 1] = palette[p + 1];
      rgba[to + 2] = palette[p + 2];
      rgba[to + 3] = palette[p + 3];
    }
  }
}

// Формат 4 (только Lossless): 15 бит big-endian по 5 на канал, строки выровнены до 4 байт.
class Rgb15Rows {
  constructor(width) {
    this.prefix = 0;
    this.stride = alignTo4(width * 2);
  }

  row(data, from, rgba, to, width) {
    for (let x = 0; x < width; x++, from += 2, to += 4) {
      const packed = (data[from] << 8) | data[from + 1];
      rgba[to] = FIVE_TO_EIGHT[(packed >> 10) & 31];
      rgba[to + 1] = FIVE_TO_EIGHT[(packed >> 5) & 31];
      rgba[to + 2] = FIVE_TO_EIGHT[packed & 31];
      rgba[to + 3] = 255;
    }
  }
}

// Формат 5: ARGB по 4 байта без выравнивания; у Lossless первый байт не значит.
class ArgbRows {
  constructor(width, lossless2) {
    this.prefix = 0;
    this.stride = width * 4;
    this.opaque = !lossless2;
  }

  row(data, from, rgba, to, width) {
    const { opaque } = this;
    const stop = from + width * 4;
    for (; from < stop; from += 4, to += 4) {
      rgba[to] = data[from + 1];
      rgba[to + 1] = data[from + 2];
      rgba[to + 2] = data[from + 3];
      rgba[to + 3] = opaque ? 255 : data[from];
    }
  }
}

// Формат → раскладка; null — формат не поддержан.
const LAYOUTS = new Map([
  [3, (width, { colors, lossless2 }) => new PaletteRows(width, colors, lossless2)],
  [4, (width, { lossless2 }) => (lossless2 ? null : new Rgb15Rows(width))],
  [5, (width, { lossless2 }) => new ArgbRows(width, lossless2)],
]);

function decodeRows(layout, data, width, height) {
  if (data.length < layout.prefix + layout.stride * height) throw new Error(TRUNCATED);
  layout.prepare?.(data);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) layout.row(data, layout.prefix + y * layout.stride, rgba, y * width * 4, width);
  return rgba;
}

export function readBitmap(bytes, tag) {
  const lossless2 = tag.code === TAG.DEFINE_BITS_LOSSLESS2;
  if (!lossless2 && tag.code !== TAG.DEFINE_BITS_LOSSLESS) return null;

  const header = new SwfReader(bytes, tag.start, tag.end);
  header.u16(); // номер символа
  const format = header.u8();
  const width = header.u16();
  const height = header.u16();
  const fits = (side) => side !== 0 && side <= MAX_SIDE;
  if (!fits(width) || !fits(height)) throw new Error(`GFX: растр ${width}×${height} вне пределов.`);
  const colors = format === 3 ? header.u8() + 1 : 0;

  // Распаковка раньше проверки формата: у неизвестного формата с битым потоком — ошибка zlib.
  const data = unzlibSync(bytes.subarray(header.offset, tag.end));
  const layout = LAYOUTS.get(format)?.(width, { colors, lossless2 }) ?? null;
  if (!layout) throw new Error(`GFX: формат растра ${format} не поддержан.`);
  return { width, height, rgba: decodeRows(layout, data, width, height) };
}
