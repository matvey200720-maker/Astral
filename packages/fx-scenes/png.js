/*
 * PNG для FX-сцен (только Node: нужен zlib). `clean.png` и `depth.png` обязаны быть без профилей и гамма-чанков (`docs/fx-scenes.md`, §2, §4):
 * браузер при чтении не должен ничего «исправлять» — у `depth.png` цвет не цвет, а закодированные метры.
 *
 *   encodePng(rgba, width, height) — RGBA 8 бит, фильтр 0, чанки IHDR/IDAT/IEND, ничего лишнего;
 *   readPng(bytes)                 — RGB/RGBA 8 бит без чересстрочной развёртки: `{ width, height, rgba, chunks }`.
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/* Чанки, которые меняют цвет при чтении: профиль, гамма, первичные цвета, sRGB-намерение. */
export const COLOUR_CHUNKS = Object.freeze(["iCCP", "gAMA", "cHRM", "sRGB"]);

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** RGBA (`Uint8Array`/`Uint8ClampedArray`, `width·height·4`) → PNG. */
export function encodePng(rgba, width, height) {
  if (rgba.length !== width * height * 4) throw new RangeError(`PNG: ${rgba.length} байт, ожидалось ${width * height * 4}`);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** PNG → `{ width, height, rgba, chunks }`; `chunks` — имена чанков по порядку. Бросает на неподдержанном виде (не 8 бит RGB/RGBA, чересстрочный). */
export function readPng(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("PNG: нет сигнатуры");
  const chunks = [];
  const data = [];
  let header = null;
  for (let at = 8; at + 12 <= buffer.length; ) {
    const size = buffer.readUInt32BE(at);
    const type = buffer.toString("latin1", at + 4, at + 8);
    if (at + 12 + size > buffer.length) throw new Error(`PNG: чанк ${type} обрезан`);
    const body = buffer.subarray(at + 8, at + 8 + size);
    if (buffer.readUInt32BE(at + 8 + size) !== crc32(buffer.subarray(at + 4, at + 8 + size))) throw new Error(`PNG: контрольная сумма чанка ${type}`);
    chunks.push(type);
    if (type === "IHDR") header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colour: body[9], interlace: body[12] };
    else if (type === "IDAT") data.push(body);
    at += 12 + size;
    if (type === "IEND") break;
  }
  if (!header) throw new Error("PNG: нет IHDR");
  const { width, height, depth, colour, interlace } = header;
  if (depth !== 8 || (colour !== 6 && colour !== 2) || interlace !== 0) throw new Error(`PNG: поддержаны 8 бит RGB/RGBA без чересстрочной развёртки (здесь ${depth} бит, тип ${colour}, интерлейс ${interlace})`);
  const bpp = colour === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length !== (stride + 1) * height) throw new Error("PNG: размер данных не сходится с IHDR");
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = y && x >= bpp ? pixels[(y - 1) * stride + x - bpp] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, corner);
      pixels[y * stride + x] = (line[x] + predictor) & 255;
    }
  }
  if (bpp === 4) return { width, height, rgba: new Uint8Array(pixels), chunks };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = pixels[i * 3];
    rgba[i * 4 + 1] = pixels[i * 3 + 1];
    rgba[i * 4 + 2] = pixels[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba, chunks };
}
