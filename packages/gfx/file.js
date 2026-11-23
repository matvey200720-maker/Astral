// Файл Scaleform (.gfx, SWF): подпись, распаковка CFX/CWS, поток тегов и оглавление символов.
import { unzlibSync } from "fflate";
import { SwfReader } from "./bits.js";

export const TWIPS = 20;

export const TAG = Object.freeze({
  END: 0,
  SHOW_FRAME: 1,
  DEFINE_SHAPE: 2,
  PLACE_OBJECT: 4,
  REMOVE_OBJECT: 5,
  DEFINE_BITS: 6,
  DEFINE_TEXT: 11,
  DO_ACTION: 12,
  DEFINE_BITS_LOSSLESS: 20,
  DEFINE_BITS_JPEG2: 21,
  DEFINE_SHAPE2: 22,
  PLACE_OBJECT2: 26,
  REMOVE_OBJECT2: 28,
  DEFINE_SHAPE3: 32,
  DEFINE_TEXT2: 33,
  DEFINE_BITS_JPEG3: 35,
  DEFINE_BITS_LOSSLESS2: 36,
  DEFINE_EDIT_TEXT: 37,
  DEFINE_SPRITE: 39,
  FRAME_LABEL: 43,
  DEFINE_MORPH_SHAPE: 46,
  EXPORT_ASSETS: 56,
  DO_INIT_ACTION: 59,
  PLACE_OBJECT3: 70,
  IMPORT_ASSETS2: 71,
  DEFINE_SHAPE4: 83,
  DEFINE_MORPH_SHAPE2: 84,
  DEFINE_EXTERNAL_IMAGE2: 1009,
});

const MAX_INFLATED = 64 * 1024 * 1024;
const MIN_MOVIE = 16;
const BODY_AFTER = 8; // подпись, версия, длина

const utf8 = new TextDecoder();

// ---------- подпись и распаковка ----------

// Кодек сжатого тела: заголовок копируется, подпись меняется на несжатую, тело — zlib.
function inflateMovie(bytes, plain) {
  const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (declared > MAX_INFLATED) throw new Error("GFX: файл больше 64 МБ.");
  const body = unzlibSync(bytes.subarray(BODY_AFTER));
  const movie = new Uint8Array(BODY_AFTER + body.length);
  movie.set(bytes.subarray(0, BODY_AFTER));
  movie.set(body, BODY_AFTER);
  for (let i = 0; i < plain.length; i++) movie[i] = plain.charCodeAt(i);
  return movie;
}

// Подпись → несжатая подпись того же вида и кодек (у несжатых — нет).
const SIGNATURES = new Map([
  ["GFX", { plain: "GFX", codec: null }],
  ["FWS", { plain: "FWS", codec: null }],
  ["CFX", { plain: "GFX", codec: inflateMovie }],
  ["CWS", { plain: "FWS", codec: inflateMovie }],
]);

const signatureOf = (bytes) => String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0);

export function isGfx(bytes) {
  return SIGNATURES.has(signatureOf(bytes));
}

export function uncompressedGfx(bytes) {
  const format = SIGNATURES.get(signatureOf(bytes));
  if (!format) throw new Error("Файл не похож на Scaleform (нет подписи GFX).");
  return format.codec ? format.codec(bytes, format.plain) : bytes;
}

// ---------- поток тегов ----------

const SHORT_HEADER = 2;
const LONG_HEADER = 6;
const LONG_MARK = 0x3f;

// Тело тега за заголовком: короткая длина — в шести младших битах, 0x3f — дальше u32.
// Позиции не приводятся к числу: строковое начало склеивается со смещениями, как прежде.
function tagBody(view, at, shortLength, end) {
  if (shortLength !== LONG_MARK) return { body: at + SHORT_HEADER, length: shortLength };
  if (at + LONG_HEADER > end) throw new Error("GFX: обрезан заголовок тега.");
  return { body: at + LONG_HEADER, length: view.getUint32(at + SHORT_HEADER, true) };
}

function* walkTags(view, start, end) {
  let at = start;
  while (at + SHORT_HEADER <= end) {
    const head = view.getUint16(at, true);
    const code = head >> 6;
    // End закрывает уровень сразу, его длина не читается.
    if (code === TAG.END) {
      yield { code, start: at + SHORT_HEADER, end: at + SHORT_HEADER };
      return;
    }
    const { body, length } = tagBody(view, at, head & LONG_MARK, end);
    const stop = body + length;
    if (stop > end) throw new Error("GFX: тег выходит за конец файла.");
    yield { code, start: body, end: stop };
    at = stop;
  }
}

export function readTags(bytes, start, end = bytes.length) {
  return [...walkTags(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), start, end)];
}

// ---------- оглавление ----------

// Строка «байт длины + байты»; не помещается в тег — null.
function lengthPrefixed(reader) {
  const size = reader.u8();
  if (reader.offset + size > reader.end) return null;
  const from = reader.offset;
  reader.offset += size;
  return utf8.decode(reader.bytes.subarray(from, reader.offset));
}

function externalImage(reader) {
  const id = reader.u32() & 0xffff;
  reader.u16();
  const width = reader.u16();
  const height = reader.u16();
  const exportName = lengthPrefixed(reader);
  if (exportName === null) return null;
  const fileName = lengthPrefixed(reader);
  if (fileName === null) return null;
  return { id, width, height, exportName, fileName };
}

const defineSymbol = (catalog, tag) => {
  const { bytes } = catalog;
  if (tag.end - tag.start < 2) return;
  const id = bytes[tag.start] | (bytes[tag.start + 1] << 8);
  if (!catalog.definitions.has(id)) catalog.definitions.set(id, tag);
};

const exportAssets = (catalog, tag) => {
  const reader = new SwfReader(catalog.bytes, tag.start, tag.end);
  for (let left = reader.u16(); left > 0; left--) {
    const id = reader.u16();
    const name = reader.string();
    if (!catalog.exports.has(name)) catalog.exports.set(name, id);
  }
};

// Битая внешняя картинка молча не даёт картинки.
const externalImage2 = (catalog, tag) => {
  let image;
  try {
    image = externalImage(new SwfReader(catalog.bytes, tag.start, tag.end));
  } catch (error) {
    if (error instanceof RangeError) return;
    throw error;
  }
  if (image) catalog.externalImages.set(image.id, image);
};

// Код тега → что он добавляет в оглавление. Определяющие символ теги несут номер в первых двух байтах тела.
const CATALOG_HANDLERS = new Map([
  ...[2, 6, 7, 10, 11, 14, 20, 21, 22, 32, 33, 34, 35, 36, 37, 39, 46, 48, 60, 75, 83, 84, 87, 90, 91].map(
    (code) => [code, defineSymbol],
  ),
  [TAG.EXPORT_ASSETS, exportAssets],
  [TAG.DEFINE_EXTERNAL_IMAGE2, externalImage2],
]);

// Реестр оглавления: принимает теги по одному, по мере обхода потока.
class Catalog {
  constructor(bytes) {
    this.bytes = bytes;
    this.tags = [];
    this.definitions = new Map();
    this.exports = new Map();
    this.externalImages = new Map();
    this.failure = null;
  }

  take(tag) {
    this.tags.push(tag);
    const handle = CATALOG_HANDLERS.get(tag.code);
    if (!handle || this.failure) return;
    // Ошибка разбора тела всплывает только после обхода: сломанный заголовок тега дальше по потоку важнее.
    try {
      handle(this, tag);
    } catch (error) {
      this.failure = { error };
    }
  }
}

// Заголовок фильма за подписью, версией и длиной.
const MOVIE_HEADER = [
  ["frame", (r) => r.rect()],
  ["frameRate", (r) => r.u16() / 256],
  ["frameCount", (r) => r.u16()],
];

export function readGfx(input) {
  const bytes = uncompressedGfx(input instanceof Uint8Array ? input : new Uint8Array(input));
  if (bytes.length < MIN_MOVIE) throw new Error("GFX: файл обрезан.");

  const reader = new SwfReader(bytes, BODY_AFTER);
  const header = {};
  for (const [key, read] of MOVIE_HEADER) header[key] = read(reader);

  const catalog = new Catalog(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const tag of walkTags(view, reader.offset, bytes.length)) catalog.take(tag);
  if (catalog.failure) throw catalog.failure.error;

  const { frame } = header;
  return {
    bytes,
    version: bytes[3],
    stage: { width: (frame.xmax - frame.xmin) / TWIPS, height: (frame.ymax - frame.ymin) / TWIPS },
    frameRate: header.frameRate,
    tags: catalog.tags,
    definitions: catalog.definitions,
    exports: catalog.exports,
    externalImages: catalog.externalImages,
  };
}
