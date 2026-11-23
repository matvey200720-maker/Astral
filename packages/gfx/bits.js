// Читатель SWF. Позиция — «байт + сколько бит этого байта уже взято», граница — `end` (конец тега).
// Целые — little-endian; битовые поля — старшим битом вперёд, подряд через границы байт.

const FIELD_PAST_END = "SWF: поле выходит за конец тега.";
const BITS_PAST_END = "SWF: битовое поле выходит за конец тега.";

const utf8 = new TextDecoder();

// LOW[k] — маска k младших бит; SCALE[k] — 2^k (сдвиг влево без потери разрядов за 32 бита).
const LOW = Array.from({ length: 9 }, (_, k) => (1 << k) - 1);
const SCALE = Array.from({ length: 9 }, (_, k) => 2 ** k);

// Столько бит, сколько целых i ≥ 0 меньше n: 1.5 → 2; 0, отрицательное и NaN → 0.
const bitCount = (n) => (n > 0 ? Math.ceil(n) : 0);

// Байт под позицией; за концом массива (при `end` дальше него) — нулевые биты.
function currentByte(reader) {
  if (!(reader.offset < reader.end)) throw new RangeError(BITS_PAST_END);
  return reader.bytes[reader.offset] | 0;
}

// Целое фиксированной ширины: выравнивание, проверка места, чтение, сдвиг позиции после удачного чтения.
function fixedWidth(reader, size, read) {
  reader.align();
  reader.need(size);
  const value = read(reader, reader.offset);
  reader.offset += size;
  return value;
}

const BYTE = (r, at) => r.bytes[at]; // за массивом — undefined, как у старого разбора
const U16 = (r, at) => r.view.getUint16(at, true);
const I16 = (r, at) => r.view.getInt16(at, true);
const U32 = (r, at) => r.view.getUint32(at, true);

// ---------- составные поля по схеме ----------
// Схема — группы значений по порядку байт. У группы: `flag` — перед ней бит «есть группа»
// (или имя флага, прочитанного заранее в `flags`); `width` — сколько бит у её «числа бит»
// (без него — общее число бит поля `shared`); `keys` — куда класть; `value` — чем читать.

const SB = (r, n) => r.sb(n);
const FB = (r, n) => r.fb(n);
const MULT = (r, n) => r.sb(n) / 256;

const RECT = { groups: [{ width: 5, keys: ["xmin", "xmax", "ymin", "ymax"], value: SB }] };

const MATRIX = {
  groups: [
    { flag: true, width: 5, keys: ["a", "d"], value: FB },
    { flag: true, width: 5, keys: ["b", "c"], value: FB },
    { width: 5, keys: ["tx", "ty"], value: SB },
  ],
};

// CXFORM: оба флага впереди (добавки, затем множители), общее число бит, но в байтах множители раньше.
function colorSchema(channels) {
  const slots = (into) => Array.from({ length: channels }, (_, i) => [into, i]);
  return {
    flags: ["add", "mult"],
    shared: 4,
    groups: [
      { flag: "mult", keys: slots("mult"), value: MULT },
      { flag: "add", keys: slots("add"), value: SB },
    ],
  };
}
const CXFORM = colorSchema(3);
const CXFORM_ALPHA = colorSchema(4);

function put(target, key, value) {
  if (typeof key === "string") target[key] = value;
  else target[key[0]][key[1]] = value;
}

function readSchema(reader, schema, target) {
  reader.align();
  const flags = {};
  for (const name of schema.flags ?? []) flags[name] = reader.ub(1);
  const shared = schema.shared ? reader.ub(schema.shared) : 0;
  for (const group of schema.groups) {
    if (group.flag !== undefined) {
      const present = group.flag === true ? reader.ub(1) : flags[group.flag];
      if (!present) continue;
    }
    const width = group.width ? reader.ub(group.width) : shared;
    for (const key of group.keys) put(target, key, group.value(reader, width));
  }
  reader.align();
  return target;
}

// Где кончается строка: первый нулевой байт или первый целый индекс не меньше `end`.
function stringStop(bytes, from, end) {
  if (!(from < end)) return from;
  if (Number.isInteger(from) && from >= 0) {
    const limit = Math.ceil(end);
    const zero = bytes.indexOf(0, from);
    return zero === -1 || zero > limit ? limit : zero;
  }
  // Дробное или отрицательное начало — побайтно: индексы вне массива нулём не бывают.
  let at = from;
  while (at < end && bytes[at] !== 0) at += 1;
  return at;
}

function colorBytes(reader, count) {
  const color = [0, 0, 0, 255];
  for (let i = 0; i < count; i++) color[i] = reader.u8();
  return color;
}

export class SwfReader {
  constructor(bytes, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = start;
    this.end = end;
    this.bit = 0;
  }

  need(count) {
    if (this.offset + count > this.end) throw new RangeError(FIELD_PAST_END);
  }

  align() {
    if (this.bit === 0) return;
    this.offset += 1;
    this.bit = 0;
  }

  u8() {
    // Индексом, а не через вид: при `end` за массивом ответ — undefined, позиция сдвигается.
    return fixedWidth(this, 1, BYTE);
  }

  u16() {
    return fixedWidth(this, 2, U16);
  }

  i16() {
    return fixedWidth(this, 2, I16);
  }

  u32() {
    return fixedWidth(this, 4, U32);
  }

  fixed8() {
    return this.i16() / 256;
  }

  string() {
    this.align();
    const from = this.offset;
    const stop = stringStop(this.bytes, from, this.end);
    const text = utf8.decode(this.bytes.subarray(from, stop));
    // За нуль, но не дальше `end`; начатая за `end` строка возвращает позицию к `end`.
    this.offset = Math.min(stop + 1, this.end);
    return text;
  }

  ub(n) {
    let wanted = bitCount(n);
    let value = 0;
    // 1. Остаток начатого байта.
    if (wanted > 0 && this.bit !== 0) {
      const room = 8 - this.bit;
      const take = wanted < room ? wanted : room;
      value = (currentByte(this) >>> (room - take)) & LOW[take];
      wanted -= take;
      if (take === room) {
        this.offset += 1;
        this.bit = 0;
      } else {
        this.bit += take;
      }
    }
    // 2. Целые байты: значение копится умножением, поля шире 32 бит не теряют разрядов.
    while (wanted >= 8) {
      value = value * 256 + currentByte(this);
      this.offset += 1;
      wanted -= 8;
    }
    // 3. Старшие биты следующего байта.
    if (wanted > 0) {
      value = value * SCALE[wanted] + (currentByte(this) >>> (8 - wanted));
      this.bit = wanted;
    }
    return value;
  }

  sb(n) {
    if (!n) return 0;
    const raw = this.ub(n);
    return raw < 2 ** (n - 1) ? raw : raw - 2 ** n;
  }

  fb(n) {
    return this.sb(n) / 65536;
  }

  rect() {
    return readSchema(this, RECT, { xmin: 0, xmax: 0, ymin: 0, ymax: 0 });
  }

  matrix() {
    return readSchema(this, MATRIX, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  }

  colorTransform(withAlpha) {
    return readSchema(this, withAlpha ? CXFORM_ALPHA : CXFORM, { mult: [1, 1, 1, 1], add: [0, 0, 0, 0] });
  }

  rgb() {
    return colorBytes(this, 3);
  }

  rgba() {
    return colorBytes(this, 4);
  }
}
