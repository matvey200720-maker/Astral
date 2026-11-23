/*
 * Кадры живой картинки (ТЗ 11.10.2026, ночь, задача 2: «не только картинку
 * загрузить, а ещё какую-то гифку»).
 *
 * `decodeGif(bytes)` — маленький декодер GIF без DOM: логический экран,
 * палитры, прозрачность, черезстрочность, способы смены кадра (оставить,
 * стереть в фон, вернуть прежний) — каждый кадр уже сложен с предыдущими,
 * как его покажет браузер. Нужен там, где нет `ImageDecoder` (тесты, старое
 * окно); в окне Astral кадры GIF, APNG и анимированного WebP разбирает
 * `ImageDecoder` браузера (`model-assets.js`).
 *
 * `planAtlas(frames)` — как кадры лягут листом-атласом: не больше 64 кадров
 * (лишние склеиваются с соседями — круг той же длины), сетка — степени
 * двойки, клетка — степень двойки до 512 px, лист — до 2048 px.
 */

import { planGifAtlas } from "@modovik/climb-contract/recolor/gif-surface";

/* Кадр без задержки браузеры держат 100 мс — так же и здесь. */
const DEFAULT_DELAY = 100;

/** Это GIF (по подписи)? */
export const isGif = (bytes) =>
  bytes.length > 6 &&
  bytes[0] === 0x47 &&
  bytes[1] === 0x49 &&
  bytes[2] === 0x46 &&
  bytes[3] === 0x38;

function lzw(data, minimum, pixels) {
  const out = new Uint8Array(pixels);
  const clear = 1 << minimum;
  const end = clear + 1;
  let size = minimum + 1;
  let mask = (1 << size) - 1;
  let next = end + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  for (let code = 0; code < clear; code += 1) {
    prefix[code] = -1;
    suffix[code] = code;
    first[code] = code;
  }
  const stack = new Uint8Array(4097);
  let previous = -1;
  let written = 0;
  let bits = 0;
  let buffer = 0;
  for (let at = 0; written < pixels;) {
    if (bits < size) {
      /* Байты кончились — последние коды уже в буфере или их нет. */
      if (at >= data.length) break;
      buffer |= data[at++] << bits;
      bits += 8;
      continue;
    }
    const code = buffer & mask;
    buffer >>>= size;
    bits -= size;
    if (code === clear) {
      size = minimum + 1;
      mask = (1 << size) - 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;
    let current = code;
    let depth = 0;
    if (previous === -1) {
      out[written++] = suffix[code];
      previous = code;
      continue;
    }
    if (code >= next) {
      /* Код, которого ещё нет: прежний + его первый знак. */
      stack[depth++] = first[previous];
      current = previous;
    }
    while (current >= clear && depth < 4096) {
      stack[depth++] = suffix[current];
      current = prefix[current];
    }
    stack[depth++] = current;
    while (depth > 0 && written < pixels) out[written++] = stack[--depth];
    if (next < 4096) {
      prefix[next] = previous;
      suffix[next] = current;
      first[next] = first[previous];
      next += 1;
      if (next > mask && size < 12) {
        size += 1;
        mask = (1 << size) - 1;
      }
    }
    previous = code;
  }
  return out;
}

/**
 * GIF → `{ width, height, frames: [{ rgba, delay }] }` (RGBA всего экрана,
 * задержка, мс). Бросает словами на чужом или битом файле.
 */
export function decodeGif(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isGif(bytes)) throw new Error("Это не GIF.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  if (!width || !height || width * height > 4096 * 4096)
    throw new Error("Гифка слишком большая или битая.");
  const packed = bytes[10];
  let at = 13;
  let global = null;
  if (packed & 0x80) {
    const count = 2 << (packed & 7);
    global = bytes.subarray(at, at + count * 3);
    at += count * 3;
  }
  const screen = new Uint8ClampedArray(width * height * 4);
  const frames = [];
  let control = { disposal: 0, transparent: -1, delay: 0 };
  const blocks = () => {
    const parts = [];
    let total = 0;
    while (at < bytes.length) {
      const length = bytes[at++];
      if (!length) break;
      parts.push(bytes.subarray(at, at + length));
      total += length;
      at += length;
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }
    return data;
  };
  while (at < bytes.length) {
    const kind = bytes[at++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9 && bytes[at] >= 4) {
        const flags = bytes[at + 1];
        control = {
          disposal: (flags >> 2) & 7,
          transparent: flags & 1 ? bytes[at + 4] : -1,
          delay: view.getUint16(at + 2, true) * 10,
        };
      }
      blocks();
      continue;
    }
    if (kind !== 0x2c) throw new Error("Гифка битая — сохраните её заново.");
    const left = view.getUint16(at, true);
    const top = view.getUint16(at + 2, true);
    const w = view.getUint16(at + 4, true);
    const h = view.getUint16(at + 6, true);
    const flags = bytes[at + 8];
    at += 9;
    let palette = global;
    if (flags & 0x80) {
      const count = 2 << (flags & 7);
      palette = bytes.subarray(at, at + count * 3);
      at += count * 3;
    }
    const minimum = bytes[at++];
    if (!palette || minimum < 2 || minimum > 11)
      throw new Error("Гифка битая — сохраните её заново.");
    const indices = lzw(blocks(), minimum, w * h);
    const before = control.disposal === 3 ? screen.slice() : null;
    /* Черезстрочные строки идут 0, 8, …; 4, …; 2, …; 1, … */
    const rows = [];
    if (flags & 0x40)
      for (const [start, step] of [
        [0, 8],
        [4, 8],
        [2, 4],
        [1, 2],
      ])
        for (let row = start; row < h; row += step) rows.push(row);
    else for (let row = 0; row < h; row += 1) rows.push(row);
    rows.forEach((row, line) => {
      const y = top + row;
      if (y >= height) return;
      for (let column = 0; column < w; column += 1) {
        const x = left + column;
        if (x >= width) continue;
        const index = indices[line * w + column];
        if (index === control.transparent) continue;
        const target = (y * width + x) * 4;
        screen[target] = palette[index * 3];
        screen[target + 1] = palette[index * 3 + 1];
        screen[target + 2] = palette[index * 3 + 2];
        screen[target + 3] = 255;
      }
    });
    frames.push({
      rgba: screen.slice(),
      delay: control.delay > 10 ? control.delay : DEFAULT_DELAY,
    });
    if (control.disposal === 2)
      for (let row = top; row < Math.min(height, top + h); row += 1)
        screen.fill(
          0,
          (row * width + left) * 4,
          (row * width + Math.min(width, left + w)) * 4,
        );
    else if (before) screen.set(before);
    control = { disposal: 0, transparent: -1, delay: 0 };
  }
  if (!frames.length) throw new Error("В гифке нет ни одного кадра.");
  return { width, height, frames };
}

/**
 * Как кадры лягут атласом: `{ keep: [номера кадров], delays, columns, rows,
 * cell: [w, h], sheet: [w, h], dropped }`. Одна раскладка у всех мест
 * (`planGifAtlas` договора): `options.side` — сторона листа (по умолчанию
 * 2048; щиты и остановки — 1024), `options.cellSide` — клетка (512).
 */
export const planAtlas = (width, height, delays, options) => planGifAtlas(width, height, delays, options);
