// Лента байт-кода AVM1: значения Push по одному и коды прочих действий,
// у каждого элемента — метод класса, в теле которого он стоит.
import { TAG } from "./file.js";

export const ACTION = Object.freeze({
  CONSTANT_POOL: 0x88,
  PUSH: 0x96,
  DEFINE_FUNCTION: 0x9b,
  DEFINE_FUNCTION2: 0x8e,
  INIT_ARRAY: 0x42,
  INIT_OBJECT: 0x43,
  GET_VARIABLE: 0x1c,
  GET_MEMBER: 0x4e,
  SET_MEMBER: 0x4f,
  CALL_METHOD: 0x52,
  GREATER: 0x67,
  LESS2: 0x48,
});

const utf8 = new TextDecoder();
const swap = new DataView(new ArrayBuffer(8));

// Строка до нуля, не дальше limit; ответ — [строка, позиция за ней].
function cString(bytes, at, limit) {
  let stop = at;
  while (stop < limit && bytes[stop] !== 0) stop += 1;
  return [utf8.decode(bytes.subarray(at, stop)), stop < limit ? stop + 1 : stop];
}

// DOUBLE в SWF: старшая 32-битная половина первой, каждая little-endian.
function swfDouble(view, at) {
  swap.setUint32(4, view.getUint32(at, true), true);
  swap.setUint32(0, view.getUint32(at + 4, true), true);
  return swap.getFloat64(0, true);
}

// Чтение значений Push по виду. Числа и индекс u16 читаются без оглядки на конец тела.
const PUSH_VALUE = [
  (c) => {
    const [text, next] = cString(c.bytes, c.at, c.bodyEnd);
    c.at = next;
    return text;
  },
  (c) => {
    const value = c.view.getFloat32(c.at, true);
    c.at += 4;
    return value;
  },
  () => null,
  () => undefined,
  (c) => ({ register: c.bytes[c.at++] }),
  (c) => c.bytes[c.at++] > 0,
  (c) => {
    const value = swfDouble(c.view, c.at);
    c.at += 8;
    return value;
  },
  (c) => {
    const value = c.view.getInt32(c.at, true);
    c.at += 4;
    return value;
  },
  (c) => {
    const index = c.bytes[c.at++];
    return c.pool ? c.pool[index] : undefined;
  },
  (c) => {
    const index = c.view.getUint16(c.at, true);
    c.at += 2;
    return c.pool ? c.pool[index] : undefined;
  },
];

function readPush(c, method, tape) {
  let last;
  let count = 0;
  while (c.at < c.bodyEnd) {
    const kind = c.bytes[c.at++];
    const read = PUSH_VALUE[kind];
    if (!read) throw new Error(`AVM1: неизвестный вид значения ${kind}.`);
    last = read(c);
    tape.push({ value: last, method });
    count += 1;
  }
  // Кандидат в имя метода — последнее значение, если это непустая строка.
  return count > 0 && typeof last === "string" && last !== "" ? last : null;
}

function readPool(c) {
  const { bytes, view, bodyEnd } = c;
  const count = view.getUint16(c.at, true);
  let at = c.at + 2;
  const pool = new Array(count);
  for (let i = 0; i < count; i++) [pool[i], at] = cString(bytes, at, bodyEnd);
  c.pool = pool;
}

// Размер тела функции из заголовка DefineFunction / DefineFunction2 (без проверки конца тела).
function functionCodeSize(c, code) {
  const { bytes, view } = c;
  let at = c.at;
  const skipString = () => {
    at = cString(bytes, at, bytes.length)[1];
  };
  skipString();
  const params = view.getUint16(at, true);
  at += 2;
  if (code === ACTION.DEFINE_FUNCTION2) {
    view.getUint8(at);
    view.getUint16(at + 1, true);
    at += 3;
    for (let i = 0; i < params; i++) {
      at += 1;
      skipString();
    }
  } else {
    for (let i = 0; i < params; i++) skipString();
  }
  return view.getUint16(at, true);
}

export function actionTape(bytes, start, end) {
  const tape = [];
  if (!(start < end)) return tape;
  const c = {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    pool: undefined,
    at: 0,
    bodyEnd: 0,
  };
  // Тела методов, объявленные по порядку; позиция только растёт, поэтому
  // закончившиеся тела снимаются с вершины, а вершина — самое позднее живое тело.
  const bodies = [];
  let candidate = null;

  for (let pos = start; pos < end; ) {
    while (bodies.length > 0 && bodies[bodies.length - 1].to <= pos) bodies.pop();
    const method = bodies.length > 0 ? bodies[bodies.length - 1].name : undefined;
    const code = bytes[pos];

    if (!(code >= 0x80)) {
      tape.push({ op: code, method });
      candidate = null;
      pos += 1;
      continue;
    }

    const bodyStart = pos + 3;
    const bodyEnd = bodyStart + (bytes[pos + 1] | (bytes[pos + 2] << 8));
    if (bodyEnd > end) throw new Error("AVM1: действие за концом кода.");
    c.at = bodyStart;
    c.bodyEnd = bodyEnd;

    if (code === ACTION.PUSH) {
      candidate = readPush(c, method, tape);
    } else {
      tape.push({ op: code, method });
      if (code === ACTION.CONSTANT_POOL) {
        readPool(c);
      } else if (code === ACTION.DEFINE_FUNCTION || code === ACTION.DEFINE_FUNCTION2) {
        const size = functionCodeSize(c, code);
        if (candidate !== null && size > 0) bodies.push({ name: candidate, to: bodyEnd + size });
      }
      candidate = null;
    }
    pos = bodyEnd;
  }
  return tape;
}

export function classTapes(gfx, names = []) {
  const tapes = [];
  for (const tag of gfx.tags) {
    if (tag.code !== TAG.DO_INIT_ACTION || tag.end - tag.start < 3) continue;
    let tape;
    try {
      tape = actionTape(gfx.bytes, tag.start + 2, tag.end);
    } catch {
      continue;
    }
    // Строгое равенство: NaN не находится; у действий значения нет — это undefined.
    const values = new Set(tape.map((item) => item.value));
    if (names.every((name) => name === name && values.has(name))) tapes.push(tape);
  }
  return tapes;
}
