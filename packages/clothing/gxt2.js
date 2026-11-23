// Таблица языка global.gxt2: текст ярлыка декодируется только при запросе.

const MAGIC = 0x47585432; // байты «2TXG»
const HEADER_SIZE = 8;
const RECORD_SIZE = 8;
const STRING_END = 0;

const GAME_MARKUP = /~[^~\s]{1,16}~/g;
const SPACE_RUN = /\s+/g;

const utf8 = new TextDecoder("utf-8");

export function labelHash(label) {
  const text = String(label).toLowerCase();
  let hash = 0;
  for (let at = 0; at < text.length; at += 1) {
    hash = (hash + text.charCodeAt(at)) | 0;
    hash = (hash + (hash << 10)) | 0;
    hash ^= hash >>> 6;
  }
  hash = (hash + (hash << 3)) | 0;
  hash ^= hash >>> 11;
  hash = (hash + (hash << 15)) | 0;
  return hash >>> 0;
}

function cleanText(raw) {
  return raw.replace(GAME_MARKUP, " ").replace(SPACE_RUN, " ").trim();
}

class LabelTable {
  constructor(bytes, view, size) {
    this.bytes = bytes;
    this.view = view;
    this.size = size;
  }

  // Делением пополам с серединой вниз: порядок записей считается верным, файлу не перепроверяем.
  findOffset(hash) {
    let low = 0;
    let high = this.size - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const record = HEADER_SIZE + middle * RECORD_SIZE;
      const candidate = this.view.getUint32(record, true);
      if (candidate === hash) return this.view.getUint32(record + 4, true);
      if (candidate < hash) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }

  textAt(offset) {
    const { bytes } = this;
    if (offset < 0 || offset >= bytes.length) return "";
    const zero = bytes.indexOf(STRING_END, offset);
    const end = zero < 0 ? bytes.length : zero;
    return cleanText(utf8.decode(bytes.subarray(offset, end)));
  }

  lookup(label) {
    return this.textAt(this.findOffset(labelHash(label)));
  }
}

export function parseGxt2(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < HEADER_SIZE || view.getUint32(0, true) !== MAGIC) {
    return { size: 0, get: () => "" };
  }
  const room = Math.floor((bytes.length - HEADER_SIZE) / RECORD_SIZE);
  const table = new LabelTable(bytes, view, Math.min(view.getUint32(4, true), room));
  return { size: table.size, get: (label) => table.lookup(label) };
}
