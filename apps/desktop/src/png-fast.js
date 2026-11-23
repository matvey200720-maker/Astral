import zlib from "node:zlib";
import { deflateRaw } from "@modovik/native-rs";

/*
 * Быстрый PNG для текстур в GLB (31.10.2026, ТЗ владельца: «вариант одежды на персонаже — быстро»).
 *
 * Замер на игре этого ПК (`scripts/perf/baseline/wear-read.mjs`, профиль): ~5 с из ~13 с JS-времени чтения одежды — `zlibSync` из fflate на уровне 9 в `@modovik/gfx/png`
 * (картинка 1024² без фильтра — сотни миллисекунд на текстуру; у плитки полки одна, у персонажа «одеть» — верх, низ и обувь заново на каждый вариант). Здесь тот же PNG
 * (пиксели байт в байт те же, PNG без потерь), но сжатие — deflate модуля Rust (`@modovik/native-rs`, а без модуля — zlib Node: оба нативные) на низком уровне: картинка
 * летит в окно по каналу между своими процессами, ей выигрыш в размере ни к чему, а время сборки — то, что ждёт человек.
 */

/** Уровень сжатия: 1 — самый быстрый из «настоящих»; размер картинки в GLB для окна не важен. */
export const PNG_FAST_LEVEL = 1;

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* CRC-32 чанка: `zlib.crc32` (Node 22+) — нативный, таблица на JS — запас. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(bytes) >>> 0;
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Adler-32 потока zlib: блоками по 5552 байт, чтобы суммы не переполняли 32 бита. */
function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let at = 0; at < bytes.length; ) {
    const end = Math.min(bytes.length, at + 5552);
    for (; at < end; at += 1) {
      a += bytes[at];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** PNG из растра `width × height × 4` (RGBA, 8 бит) — тот же, что у `@modovik/gfx/png`, но быстро. */
export function encodePngFast(rgba, width, height) {
  const stride = width * 4;
  if (!rgba || rgba.length < stride * height) throw new RangeError("PNG: растр меньше заявленного размера.");
  const rows = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) rows.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const packed = deflateRaw(rows, { level: PNG_FAST_LEVEL });
  /* Поток zlib: заголовок 0x78 0x01 (окно 32 КБ, самый быстрый), сырое deflate, Adler-32 несжатого. */
  const stream = new Uint8Array(2 + packed.byteLength + 4);
  stream[0] = 0x78;
  stream[1] = 0x01;
  stream.set(packed, 2);
  new DataView(stream.buffer).setUint32(2 + packed.byteLength, adler32(rows));
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const parts = [SIGNATURE, chunk("IHDR", header), chunk("IDAT", stream), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
