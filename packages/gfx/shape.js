// Фигуры SWF (DefineShape 1–4) и начальный вид морфов (DefineMorphShape 1–2)
// в плоском виде: массивы стилей и рёбра с номерами стилей и прогона. Координаты в твипах.
import { SwfReader } from "./bits.js";
import { TAG } from "./file.js";

const CAPS = ["round", "none", "square", "round"];
const JOINS = ["round", "bevel", "miter", "round"];
const SPREADS = ["pad", "reflect", "repeat", "pad"];
const RECORD_LIMIT = 1_000_000;

const gradientType = (type) => (type === 0x10 ? "linear" : "radial");
const color = (r, alpha) => (alpha ? r.rgba() : r.rgb());

// ---------- заливки: тип → чтение ----------

function bitmapStyle(r, type, morph) {
  const bitmapId = r.u16();
  const matrix = r.matrix();
  if (morph) r.matrix(); // конечная матрица морфа
  return { type: "bitmap", bitmapId, matrix, repeat: (type & 1) === 0, smooth: (type & 2) === 0 };
}

const BITMAP_TYPES = [0x40, 0x41, 0x42, 0x43];
const GRADIENT_TYPES = [0x10, 0x12, 0x13];

const FILL_TYPES = new Map([
  [
    0x00,
    (r, type, alpha) => {
      const at = r.offset;
      return { type: "solid", color: color(r, alpha), at, alpha };
    },
  ],
  ...GRADIENT_TYPES.map((code) => [
    code,
    (r, type, alpha) => {
      const matrix = r.matrix();
      const head = r.u8();
      const stops = [];
      for (let left = head & 15; left > 0; left--) stops.push({ ratio: r.u8() / 255, color: color(r, alpha) });
      return {
        type: gradientType(type),
        matrix,
        spread: SPREADS[head >> 6],
        linearRgb: ((head >> 4) & 3) === 1,
        stops,
        focal: type === 0x13 ? r.fixed8() : 0,
      };
    },
  ]),
  ...BITMAP_TYPES.map((code) => [code, (r, type) => bitmapStyle(r, type, false)]),
]);

// У морфа пары «начало/конец»; в ответ идёт начало, разлив и интерполяция отбрасываются.
const MORPH_FILL_TYPES = new Map([
  [
    0x00,
    (r) => {
      const start = r.rgba();
      r.rgba();
      return { type: "solid", color: start };
    },
  ],
  ...GRADIENT_TYPES.map((code) => [
    code,
    (r, type) => {
      const matrix = r.matrix();
      r.matrix();
      const stops = [];
      for (let left = r.u8() & 15; left > 0; left--) {
        const ratio = r.u8() / 255;
        const start = r.rgba();
        r.u8();
        r.rgba();
        stops.push({ ratio, color: start });
      }
      if (type === 0x13) {
        r.fixed8();
        r.fixed8();
      }
      return { type: gradientType(type), matrix, spread: "pad", linearRgb: false, stops, focal: 0 };
    },
  ]),
  ...BITMAP_TYPES.map((code) => [code, (r, type) => bitmapStyle(r, type, true)]),
]);

function fillStyle(r, alpha) {
  const type = r.u8();
  const read = FILL_TYPES.get(type);
  if (!read) throw new Error(`GFX: неизвестная заливка 0x${type.toString(16)}.`);
  return read(r, type, alpha);
}

function morphFillStyle(r) {
  const type = r.u8();
  const read = MORPH_FILL_TYPES.get(type);
  if (!read) throw new Error(`GFX: неизвестная заливка морфа 0x${type.toString(16)}.`);
  return read(r, type);
}

// ---------- обводки ----------

const roundLine = (width, lineColor) => ({
  width,
  color: lineColor,
  startCap: "round",
  endCap: "round",
  join: "round",
  scaling: "normal",
});

// Два байта флагов LINESTYLE2 → начало объекта обводки и признак заливки вместо цвета.
function lineFlags(width, first, second) {
  return {
    style: {
      width,
      startCap: CAPS[first >> 6],
      endCap: CAPS[second & 3],
      join: JOINS[(first >> 4) & 3],
      scaling: first & 0x06 ? "none" : "normal",
    },
    filled: (first & 0x08) !== 0,
  };
}

function lineStyle2(r) {
  const width = r.u16();
  const { style, filled } = lineFlags(width, r.u8(), r.u8());
  if (style.join === "miter") style.miterLimit = r.fixed8();
  if (filled) style.fill = fillStyle(r, true);
  else style.color = r.rgba();
  return style;
}

function morphLineStyle(r) {
  const width = r.u16();
  r.u16();
  const start = r.rgba();
  r.rgba();
  return roundLine(width, start);
}

function morphLineStyle2(r) {
  const width = r.u16();
  r.u16();
  const { style, filled } = lineFlags(width, r.u8(), r.u8());
  if (style.join === "miter") r.u16();
  if (filled) {
    style.fill = morphFillStyle(r);
  } else {
    style.color = r.rgba();
    r.rgba();
  }
  return style;
}

// ---------- виды тегов ----------

const HEADER_FIELDS = {
  bounds: (r) => r.rect(),
  endBounds: (r) => r.rect(),
  edgeBounds: (r) => r.rect(),
  endEdgeBounds: (r) => r.rect(),
  flags: (r) => r.u8(),
  morphOffset: (r) => r.u32(),
};

const plainFill = (r) => fillStyle(r, false);
const alphaFill = (r) => fillStyle(r, true);

// Код тега → заголовок по порядку байт, расширенный ли счёт стилей, чем читать заливку и обводку.
const KINDS = new Map([
  [TAG.DEFINE_SHAPE, { morph: false, header: ["bounds"], wide: false, fill: plainFill, line: (r) => roundLine(r.u16(), r.rgb()) }],
  [TAG.DEFINE_SHAPE2, { morph: false, header: ["bounds"], wide: true, fill: plainFill, line: (r) => roundLine(r.u16(), r.rgb()) }],
  [TAG.DEFINE_SHAPE3, { morph: false, header: ["bounds"], wide: true, fill: alphaFill, line: (r) => roundLine(r.u16(), r.rgba()) }],
  [TAG.DEFINE_SHAPE4, { morph: false, header: ["bounds", "edgeBounds", "flags"], wide: true, fill: alphaFill, line: lineStyle2 }],
  [
    TAG.DEFINE_MORPH_SHAPE,
    { morph: true, header: ["bounds", "endBounds", "morphOffset"], wide: true, fill: morphFillStyle, line: morphLineStyle },
  ],
  [
    TAG.DEFINE_MORPH_SHAPE2,
    {
      morph: true,
      header: ["bounds", "endBounds", "edgeBounds", "endEdgeBounds", "flags", "morphOffset"],
      wide: true,
      fill: morphFillStyle,
      line: morphLineStyle2,
    },
  ],
]);

export function isShapeTag(code) {
  return KINDS.get(code)?.morph === false;
}

export function isMorphTag(code) {
  return KINDS.get(code)?.morph === true;
}

function styleArrays(r, kind, fills, lines) {
  const count = () => {
    const short = r.u8();
    return short === 0xff && kind.wide ? r.u16() : short;
  };
  for (let n = count(); n > 0; n--) fills.push(kind.fill(r));
  for (let n = count(); n > 0; n--) lines.push(kind.line(r));
}

// ---------- записи фигуры: перо и шаги смены стиля ----------

// Номер стиля в записи: 0 — нет (−1), N — N-й стиль набора, начатого с `base`.
function styleNumber(r, bits, base) {
  const n = r.ub(bits);
  return n === 0 ? -1 : base + n - 1;
}

// Флаг записи смены стиля → шаг. Шаги идут в порядке полей в байтах; номера стилей записи
// с новыми стилями считаются ещё от прежнего набора.
const STYLE_CHANGE = [
  [
    0x01,
    (pen) => {
      const bits = pen.r.ub(5);
      pen.x = pen.r.sb(bits);
      pen.y = pen.r.sb(bits);
    },
  ],
  [
    0x02,
    (pen) => {
      pen.fill0 = styleNumber(pen.r, pen.fillBits, pen.fillBase);
    },
  ],
  [
    0x04,
    (pen) => {
      pen.fill1 = styleNumber(pen.r, pen.fillBits, pen.fillBase);
    },
  ],
  [
    0x08,
    (pen) => {
      pen.line = styleNumber(pen.r, pen.lineBits, pen.lineBase);
    },
  ],
  [0x10, (pen, flags) => pen.newStyles(flags)],
];

class Pen {
  constructor(r, kind, fills, lines) {
    this.r = r;
    this.kind = kind;
    this.fills = fills;
    this.lines = lines;
    r.align();
    this.fillBits = r.ub(4);
    this.lineBits = r.ub(4);
    this.fillBase = 0;
    this.lineBase = 0;
    this.x = 0;
    this.y = 0;
    this.fill0 = -1;
    this.fill1 = -1;
    this.line = -1;
    this.run = 0;
    this.edges = [];
  }

  straight(bits) {
    const r = this.r;
    const general = r.ub(1);
    const vertical = general ? 0 : r.ub(1);
    const dx = general || !vertical ? r.sb(bits) : 0;
    const dy = general || vertical ? r.sb(bits) : 0;
    const { x, y, fill0, fill1, line, run } = this;
    this.edges.push({ x0: x, y0: y, x1: x + dx, y1: y + dy, fill0, fill1, line, run });
    this.x = x + dx;
    this.y = y + dy;
  }

  curve(bits) {
    const r = this.r;
    const { x, y, fill0, fill1, line, run } = this;
    const cx = x + r.sb(bits);
    const cy = y + r.sb(bits);
    const x1 = cx + r.sb(bits);
    const y1 = cy + r.sb(bits);
    this.edges.push({ x0: x, y0: y, cx, cy, x1, y1, fill0, fill1, line, run });
    this.x = x1;
    this.y = y1;
  }

  newStyles(flags) {
    if (this.kind.morph) throw new Error("GFX: новые стили внутри морфа.");
    this.fillBase = this.fills.length;
    this.lineBase = this.lines.length;
    styleArrays(this.r, this.kind, this.fills, this.lines);
    this.fillBits = this.r.ub(4);
    this.lineBits = this.r.ub(4);
    // Не выбранные в этой записи стили сбрасываются.
    if (!(flags & 0x02)) this.fill0 = -1;
    if (!(flags & 0x04)) this.fill1 = -1;
    if (!(flags & 0x08)) this.line = -1;
  }

  // Одна запись; false — запись конца фигуры.
  step() {
    const r = this.r;
    if (r.ub(1) === 1) {
      const isStraight = r.ub(1);
      const bits = r.ub(4) + 2;
      if (isStraight) this.straight(bits);
      else this.curve(bits);
      return true;
    }
    const flags = r.ub(5);
    if (flags === 0) return false;
    this.run += 1;
    for (const [mask, apply] of STYLE_CHANGE) if (flags & mask) apply(this, flags);
    return true;
  }

  trace() {
    for (let records = 0; records < RECORD_LIMIT; records++) {
      if (!this.step()) return this.edges;
    }
    throw new Error("GFX: фигура без конца.");
  }
}

export function readShape(bytes, tag) {
  const r = new SwfReader(bytes, tag.start, tag.end);
  const id = r.u16();
  const kind = KINDS.get(tag.code);
  if (!kind) throw new TypeError("GFX: это не фигура.");

  const header = {};
  for (const field of kind.header) header[field] = HEADER_FIELDS[field](r);

  const fills = [];
  const lines = [];
  styleArrays(r, kind, fills, lines);
  const edges = new Pen(r, kind, fills, lines).trace();
  return { id, bounds: header.bounds, fills, lines, edges, morph: kind.morph };
}
