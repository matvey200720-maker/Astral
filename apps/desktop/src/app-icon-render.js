/*
 * Значок приложения → картинки (ТЗ 29.10.2026-c): по настройкам рисует из SVG окно (`png`, 256 px) и ярлык (`ico`).
 * Считает `sharp`, поэтому модуль зовут только через `runOffThread` (`app-icon.js`): главный процесс окна на это время
 * не стоит. Вход и ответ — простые данные, годные для переноса между потоками.
 *
 * ICO — в виде, который читает любая Windows от Vista, панель задач и Проводник:
 *   - 16, 20, 24, 32, 40, 48 — кадры BMP (32 бита BGRA снизу вверх и маска AND по прозрачности): их берут панель задач,
 *     заголовок окна и список на любом масштабе экрана, в том числе самые старые пути рисования значка;
 *   - 64, 128, 256 — кадры PNG (Vista и новее), как у значков самой Windows: крупные образцы Проводника.
 * Прозрачность — настоящая, альфа-канал на каждом кадре: «Без фона» не превращается в чёрный или белый квадрат.
 * Каждый размер сжат из одного большого рисунка (Lanczos), а не растянут с одного маленького.
 */

import sharp from "sharp";
import { appIconSvg, normalizeAppIconLook } from "@modovik/contracts/app-icon";

export const ICO_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256]);
/* С этого размера кадр ICO — PNG; ниже — BMP. */
const PNG_FROM = 64;
/* Картинка для окна (`BrowserWindow.setIcon`). */
const WINDOW_SIZE = 256;
/* Рисунок, с которого сжимаются все размеры: вдвое больше крупного кадра — края звезды сглажены без ступенек. */
const SOURCE_SIZE = 1024;

/** Кадр BMP для ICO: заголовок, пиксели BGRA снизу вверх, затем маска AND (1 — прозрачно) со строками по 4 байта. */
export function dibFrame(size, rgba) {
  const maskRow = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y += 1) {
    const from = y * size * 4;
    const to = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x += 1) {
      const source = from + x * 4;
      const target = to + x * 4;
      pixels[target] = rgba[source + 2];
      pixels[target + 1] = rgba[source + 1];
      pixels[target + 2] = rgba[source];
      pixels[target + 3] = rgba[source + 3];
      if (rgba[source + 3] < 128) mask[(size - 1 - y) * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

/** ICO из готовых кадров `{ size, data }`: размер 256 в заголовке записывается нулём. */
export function icoFromFrames(frames) {
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach((frame, index) => {
    const entry = 6 + 16 * index;
    head[entry] = frame.size >= 256 ? 0 : frame.size;
    head[entry + 1] = frame.size >= 256 ? 0 : frame.size;
    head.writeUInt16LE(1, entry + 4);
    head.writeUInt16LE(32, entry + 6);
    head.writeUInt32LE(frame.data.length, entry + 8);
    head.writeUInt32LE(offset, entry + 12);
    offset += frame.data.length;
  });
  return Buffer.concat([head, ...frames.map((frame) => frame.data)]);
}

/** Настройки значка → `{ png, ico }` (Uint8Array: так буферы переходят между потоками). */
export async function renderAppIcon(value, { sizes = ICO_SIZES } = {}) {
  const look = normalizeAppIconLook(value);
  const big = await sharp(Buffer.from(appIconSvg(look)), { density: (72 * SOURCE_SIZE) / 512 })
    .resize(SOURCE_SIZE, SOURCE_SIZE)
    .png()
    .toBuffer();
  const resized = (size) => sharp(big).resize(size, size, { kernel: "lanczos3" }).ensureAlpha();
  const frames = [];
  for (const size of sizes) {
    const data =
      size >= PNG_FROM
        ? await resized(size).png({ compressionLevel: 9 }).toBuffer()
        : dibFrame(size, await resized(size).raw().toBuffer());
    frames.push({ size, data });
  }
  const png = await resized(WINDOW_SIZE).png({ compressionLevel: 9 }).toBuffer();
  return { png: new Uint8Array(png), ico: new Uint8Array(icoFromFrames(frames)) };
}
