/*
 * Шрифт Scaleform GFx «DefineCompactedFont» (тег 1005) — так лежат шрифты
 * в библиотеках GTA V (`font_lib_efigs_pc.gfx` и др.). Формат разобран по
 * настоящим файлам игры (все девять шрифтов библиотеки читаются целиком):
 *
 *   тег: UI16 номер шрифта, затем запись шрифта:
 *     строка имени с нулём, UI16 флаги, UI16 кегль (256), SI16 подъём,
 *     спуск, интерлиньяж, UI32 число глифов, UI32 длина байт глифов, глифы,
 *     таблица глифов: { UI16 код, SI16 ширина, UI32 смещение }, смещение —
 *     от начала записи (от имени), коды по возрастанию,
 *     UI30 число пар кернинга, пары { UI16, UI16, SI16 }.
 *   глиф: SI15 ×4 рамка (пустой — 16383, 16383, −16383, −16383), UI15
 *     число контуров, контур: SI15 начало x, y, UI30 N (N & 1 — ссылка на
 *     рёбра другого контура по смещению N >> 1, иначе N >> 1 рёбер), рёбра:
 *     младшие 4 бита — вид (H12, H20, V12, V20, L6…L18, C5…C19), дальше
 *     числа подряд младшими битами вперёд.
 *
 * Координаты — единицы кегля, базовая линия 0, ось Y вниз.
 */

const EMPTY_BOX = Object.freeze([16383, 16383, -16383, -16383]);
const EDGES = Object.freeze([
  ["H", 12],
  ["H", 20],
  ["V", 12],
  ["V", 20],
  ["L", 6],
  ["L", 10],
  ["L", 14],
  ["L", 18],
  ["C", 5],
  ["C", 7],
  ["C", 9],
  ["C", 11],
  ["C", 13],
  ["C", 15],
  ["C", 17],
  ["C", 19],
]);

/* ---------- чтение ---------- */

function readUI15(bytes, at) {
  const b0 = bytes[at];
  if (!(b0 & 1)) return { value: b0 >> 1, next: at + 1 };
  return { value: (b0 >> 1) | (bytes[at + 1] << 7), next: at + 2 };
}
function readSI15(bytes, at) {
  const b0 = bytes[at];
  if (!(b0 & 1)) {
    const v = b0 >> 1;
    return { value: v & 0x40 ? v - 0x80 : v, next: at + 1 };
  }
  const v = (b0 >> 1) | (bytes[at + 1] << 7);
  return { value: v & 0x4000 ? v - 0x8000 : v, next: at + 2 };
}
function readUI30(bytes, at) {
  const b0 = bytes[at];
  const extra = b0 & 3;
  let value = b0 >> 2;
  for (let k = 1; k <= extra; k += 1) value |= bytes[at + k] << (6 + 8 * (k - 1));
  return { value: value >>> 0, next: at + 1 + extra };
}
const signed = (value, bits) => (value & (1 << (bits - 1)) ? value - (1 << bits) : value);

function readEdge(bytes, at) {
  const type = bytes[at] & 15;
  const [kind, bits] = EDGES[type];
  const count = kind === "C" ? 4 : kind === "L" ? 2 : 1;
  const length = Math.ceil((4 + bits * count) / 8);
  let acc = 0n;
  for (let k = 0; k < length; k += 1) acc |= BigInt(bytes[at + k]) << BigInt(8 * k);
  acc >>= 4n;
  const values = [];
  for (let k = 0; k < count; k += 1) {
    values.push(signed(Number(acc & ((1n << BigInt(bits)) - 1n)), bits));
    acc >>= BigInt(bits);
  }
  return { kind, values, next: at + length };
}

/* Глиф по смещению от начала записи: `{ box, contours }`, контуры — сегменты. */
function readGlyph(record, offset) {
  const bytes = record.bytes;
  let at = offset;
  const box = [];
  for (let k = 0; k < 4; k += 1) {
    const value = readSI15(bytes, at);
    box.push(value.value);
    at = value.next;
  }
  const count = readUI15(bytes, at);
  at = count.next;
  const edgesAt = (pos, depth) => {
    const head = readUI30(bytes, pos);
    if (head.value & 1) {
      if (depth) throw new Error("Шрифт GFx: ссылка на ссылку рёбер.");
      return { edges: edgesAt(head.value >> 1, 1).edges, next: head.next };
    }
    const edges = [];
    let next = head.next;
    for (let k = 0; k < head.value >> 1; k += 1) {
      const edge = readEdge(bytes, next);
      edges.push(edge);
      next = edge.next;
    }
    return { edges, next };
  };
  const contours = [];
  for (let c = 0; c < count.value; c += 1) {
    const mx = readSI15(bytes, at);
    const my = readSI15(bytes, mx.next);
    const list = edgesAt(my.next, 0);
    at = list.next;
    let x = mx.value;
    let y = my.value;
    const segments = [];
    for (const edge of list.edges) {
      if (edge.kind === "H") segments.push({ x: (x += edge.values[0]), y });
      else if (edge.kind === "V") segments.push({ x, y: (y += edge.values[0]) });
      else if (edge.kind === "L") segments.push({ x: (x += edge.values[0]), y: (y += edge.values[1]) });
      else {
        const cx = x + edge.values[0];
        const cy = y + edge.values[1];
        x = cx + edge.values[2];
        y = cy + edge.values[3];
        segments.push({ cx, cy, x, y });
      }
    }
    contours.push({ start: { x: mx.value, y: my.value }, segments });
  }
  return { box, contours };
}

/**
 * Тег 1005 (байты тела): `{ id, name, flags, nominal, ascent, descent,
 * leading, glyphs: [{ code, advance, box, contours }], kerning }`.
 */
export function readCompactedFont(body) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = view.getUint16(0, true);
  const recordStart = 2;
  let at = recordStart;
  while (bytes[at] !== 0) at += 1;
  const name = new TextDecoder().decode(bytes.subarray(recordStart, at));
  at += 1;
  const flags = view.getUint16(at, true);
  const nominal = view.getUint16(at + 2, true);
  const ascent = view.getInt16(at + 4, true);
  const descent = view.getInt16(at + 6, true);
  const leading = view.getInt16(at + 8, true);
  const count = view.getUint32(at + 10, true);
  const glyphBytes = view.getUint32(at + 14, true);
  at += 18;
  const record = { bytes: bytes.subarray(recordStart) };
  at += glyphBytes;
  const glyphs = [];
  for (let k = 0; k < count; k += 1) {
    const code = view.getUint16(at, true);
    const advance = view.getInt16(at + 2, true);
    const offset = view.getUint32(at + 4, true);
    at += 8;
    const glyph = readGlyph(record, offset);
    glyphs.push({ code, advance, box: glyph.box, contours: glyph.contours });
  }
  const pairs = readUI30(bytes, at);
  at = pairs.next;
  const kerning = [];
  for (let k = 0; k < pairs.value; k += 1) {
    kerning.push({ a: view.getUint16(at, true), b: view.getUint16(at + 2, true), advance: view.getInt16(at + 4, true) });
    at += 6;
  }
  return { id, name, flags, nominal, ascent, descent, leading, glyphs, kerning, end: at };
}

/* ---------- запись ---------- */

function pushUI15(out, value) {
  if (value < 0 || value > 0x7fff) throw new Error(`Шрифт GFx: ${value} не помещается в UI15.`);
  if (value < 128) out.push(value << 1);
  else out.push(((value & 0x7f) << 1) | 1, (value >> 7) & 0xff);
}
function pushSI15(out, value) {
  if (value < -16384 || value > 16383) throw new Error(`Шрифт GFx: ${value} не помещается в SI15.`);
  if (value >= -64 && value <= 63) out.push((value & 0x7f) << 1);
  else {
    const raw = value & 0x7fff;
    out.push(((raw & 0x7f) << 1) | 1, (raw >> 7) & 0xff);
  }
}
function pushUI30(out, value) {
  if (value < 64) out.push(value << 2);
  else if (value < 1 << 14) out.push(((value & 0x3f) << 2) | 1, (value >> 6) & 0xff);
  else if (value < 1 << 22) out.push(((value & 0x3f) << 2) | 2, (value >> 6) & 0xff, (value >> 14) & 0xff);
  else out.push(((value & 0x3f) << 2) | 3, (value >> 6) & 0xff, (value >> 14) & 0xff, (value >> 22) & 0xff);
}
const fits = (value, bits) => value >= -(1 << (bits - 1)) && value < 1 << (bits - 1);

function pushEdge(out, type, bits, values) {
  let acc = BigInt(type);
  let shift = 4n;
  for (const value of values) {
    acc |= (BigInt(value) & ((1n << BigInt(bits)) - 1n)) << shift;
    shift += BigInt(bits);
  }
  const length = Math.ceil(Number(shift) / 8);
  for (let k = 0; k < length; k += 1) out.push(Number((acc >> BigInt(8 * k)) & 0xffn));
}

/* Ребро от точки (x, y): самый короткий вид, в который влезают числа. */
function pushSegment(out, x, y, segment) {
  if (!("cx" in segment)) {
    const dx = segment.x - x;
    const dy = segment.y - y;
    if (dy === 0 && fits(dx, 12)) return pushEdge(out, 0, 12, [dx]);
    if (dy === 0 && fits(dx, 20)) return pushEdge(out, 1, 20, [dx]);
    if (dx === 0 && fits(dy, 12)) return pushEdge(out, 2, 12, [dy]);
    if (dx === 0 && fits(dy, 20)) return pushEdge(out, 3, 20, [dy]);
    for (const [type, bits] of [[4, 6], [5, 10], [6, 14], [7, 18]]) if (fits(dx, bits) && fits(dy, bits)) return pushEdge(out, type, bits, [dx, dy]);
    throw new Error("Шрифт GFx: ребро длиннее 18 бит.");
  }
  const values = [segment.cx - x, segment.cy - y, segment.x - segment.cx, segment.y - segment.cy];
  for (let type = 8; type < 16; type += 1) {
    const bits = EDGES[type][1];
    if (values.every((value) => fits(value, bits))) return pushEdge(out, type, bits, values);
  }
  throw new Error("Шрифт GFx: кривая длиннее 19 бит.");
}

/* Контуры в целых единицах без нулевых рёбер. */
function roundContours(contours) {
  const out = [];
  for (const contour of contours) {
    let x = Math.round(contour.start.x);
    let y = Math.round(contour.start.y);
    const start = { x, y };
    const segments = [];
    for (const segment of contour.segments) {
      const next = "cx" in segment
        ? { cx: Math.round(segment.cx), cy: Math.round(segment.cy), x: Math.round(segment.x), y: Math.round(segment.y) }
        : { x: Math.round(segment.x), y: Math.round(segment.y) };
      if (!("cx" in next) && next.x === x && next.y === y) continue;
      if ("cx" in next && next.x === x && next.y === y && next.cx === x && next.cy === y) continue;
      segments.push(next);
      x = next.x;
      y = next.y;
    }
    if (segments.length >= 2) out.push({ start, segments });
  }
  return out;
}

/** Глиф в байты: контуры — сегменты в единицах кегля (ось Y вниз). */
export function encodeGlyph(contours) {
  const rounded = roundContours(contours || []);
  const out = [];
  let box = EMPTY_BOX;
  if (rounded.length) {
    box = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (x, y) => {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    };
    for (const contour of rounded) {
      add(contour.start.x, contour.start.y);
      for (const segment of contour.segments) {
        if ("cx" in segment) add(segment.cx, segment.cy);
        add(segment.x, segment.y);
      }
    }
  }
  for (const value of box) pushSI15(out, value);
  pushUI15(out, rounded.length);
  for (const contour of rounded) {
    pushSI15(out, contour.start.x);
    pushSI15(out, contour.start.y);
    pushUI30(out, contour.segments.length << 1);
    let x = contour.start.x;
    let y = contour.start.y;
    for (const segment of contour.segments) {
      pushSegment(out, x, y, segment);
      x = segment.x;
      y = segment.y;
    }
  }
  return out;
}

/**
 * Тело тега 1005 из шрифта: `{ id, name, flags, nominal, ascent, descent,
 * leading, glyphs: [{ code, advance, contours }], kerning: [{ a, b, advance }] }`.
 * Коды — по возрастанию, без повторов.
 */
export function encodeCompactedFont(font) {
  const glyphs = [...font.glyphs].sort((a, b) => a.code - b.code);
  for (let k = 1; k < glyphs.length; k += 1) if (glyphs[k].code === glyphs[k - 1].code) throw new Error(`Шрифт GFx: символ ${glyphs[k].code} дважды.`);
  const name = new TextEncoder().encode(font.name);
  const base = name.length + 1 + 18;
  const glyphBytes = [];
  const offsets = [];
  for (const glyph of glyphs) {
    offsets.push(base + glyphBytes.length);
    for (const byte of encodeGlyph(glyph.contours)) glyphBytes.push(byte);
  }
  const kerning = font.kerning || [];
  const tail = [];
  pushUI30(tail, kerning.length);
  const size = 2 + base + glyphBytes.length + glyphs.length * 8 + tail.length + kerning.length * 6;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  view.setUint16(at, font.id, true);
  at += 2;
  out.set(name, at);
  at += name.length;
  out[at++] = 0;
  view.setUint16(at, font.flags ?? 0x6000, true);
  view.setUint16(at + 2, font.nominal ?? 256, true);
  view.setInt16(at + 4, font.ascent, true);
  view.setInt16(at + 6, font.descent, true);
  view.setInt16(at + 8, font.leading, true);
  view.setUint32(at + 10, glyphs.length, true);
  view.setUint32(at + 14, glyphBytes.length, true);
  at += 18;
  out.set(glyphBytes, at);
  at += glyphBytes.length;
  glyphs.forEach((glyph, index) => {
    view.setUint16(at, glyph.code, true);
    view.setInt16(at + 2, Math.max(-32768, Math.min(32767, Math.round(glyph.advance))), true);
    view.setUint32(at + 4, offsets[index], true);
    at += 8;
  });
  out.set(tail, at);
  at += tail.length;
  for (const pair of kerning) {
    view.setUint16(at, pair.a, true);
    view.setUint16(at + 2, pair.b, true);
    view.setInt16(at + 4, Math.max(-32768, Math.min(32767, Math.round(pair.advance))), true);
    at += 6;
  }
  return out;
}
