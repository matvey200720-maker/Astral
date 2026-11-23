// Растр RGB/RGBA → файл PNG байт в байт одинаково везде: IHDR, один IDAT (zlib уровня 9 из fflate), IEND.
import { zlibSync } from "fflate";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COLOR_TYPE = { 3: 2, 4: 6 };
const CHUNK_OVERHEAD = 12;

let crcTable = null;

function crcTableOnce() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(bytes, start, end) {
  const table = crcTableOnce();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Пишет кусок в `file` с позиции `at`: длина, тип, данные, CRC типа и данных. Ответ — позиция после куска.
function putChunk(file, view, at, type, data) {
  view.setUint32(at, data.length);
  for (let i = 0; i < 4; i++) file[at + 4 + i] = type.charCodeAt(i);
  file.set(data, at + 8);
  const end = at + 8 + data.length;
  view.setUint32(end, crc32(file, at + 4, end));
  return end + 4;
}

function headerData(width, height, channels) {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width >>> 0);
  view.setUint32(4, height >>> 0);
  data[8] = 8;
  data[9] = COLOR_TYPE[channels];
  // Сжатие, фильтр и чередование — нули.
  return data;
}

// Строки с байтом фильтра 0 впереди; длина строки — ширина × каналы без округления.
function filteredRows(pixels, width, height, channels) {
  const rowBytes = width * channels;
  const stride = rowBytes + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * stride + 1);
  }
  return raw;
}

export function encodePng(pixels, width, height, channels = 4) {
  if (channels !== 3 && channels !== 4) throw new RangeError("PNG: только RGB или RGBA.");
  if (pixels.length < width * channels * height) throw new RangeError("PNG: растр меньше заявленного размера.");

  const header = headerData(width, height, channels);
  const image = zlibSync(filteredRows(pixels, width, height, channels), { level: 9 });

  const file = new Uint8Array(SIGNATURE.length + CHUNK_OVERHEAD * 3 + header.length + image.length);
  const view = new DataView(file.buffer);
  file.set(SIGNATURE);
  let at = SIGNATURE.length;
  at = putChunk(file, view, at, "IHDR", header);
  at = putChunk(file, view, at, "IDAT", image);
  putChunk(file, view, at, "IEND", new Uint8Array(0));
  return file;
}
