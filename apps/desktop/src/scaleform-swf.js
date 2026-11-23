import zlib from "node:zlib";

/*
 * Устройство SWF внутри Scaleform-файлов игры: теги, матрицы, размещения.
 *
 * AVM1 (`scaleform-avm1.js`) отвечает за код, этот модуль — за кадр: какие
 * символы есть в файле, под какими именами их экспортируют, где внутри
 * спрайта стоит экземпляр и как записать новый. Компилятору мини-карты
 * мало знать номера спрайтов: номера меняются от сборки к сборке игры, а
 * имена экспорта (`HEALTH_ARMOUR_ABILITY_SMALL`, `radar_centre`) и имена
 * экземпляров (`healthArmourMC`) — нет, их читает ActionScript самой игры.
 *
 * Матрица здесь — обычная аффинная: x' = a·x + c·y + tx, y' = b·x + d·y + ty
 * (в SWF это ScaleX, RotateSkew0, RotateSkew1, ScaleY). Поворот — по часовой
 * стрелке на экране с осью y вниз, как `rotate()` в CSS и `_rotation` во
 * Flash: так редактор и игра понимают угол одинаково.
 */

export const TWIPS = 20;

export const SWF_TAG = Object.freeze({
  END: 0,
  SHOW_FRAME: 1,
  DEFINE_SHAPE: 2,
  SET_BACKGROUND_COLOR: 9,
  PLACE_OBJECT2: 26,
  REMOVE_OBJECT2: 28,
  DEFINE_SHAPE2: 22,
  DEFINE_SHAPE3: 32,
  DEFINE_EDIT_TEXT: 37,
  DEFINE_SPRITE: 39,
  DO_ACTION: 12,
  EXPORT_ASSETS: 56,
  DO_INIT_ACTION: 59,
  IMPORT_ASSETS2: 71,
  PLACE_OBJECT3: 70,
  DEFINE_SHAPE4: 83,
  DEFINE_SCALING_GRID: 78,
  DEFINE_BITS_JPEG2: 21,
  DEFINE_BITS_LOSSLESS2: 36,
});

/* Теги Scaleform поверх SWF (номера из заголовков gfxexport). */
export const SCALEFORM_TAG = Object.freeze({
  EXPORTER_INFO: 1000,
  DEFINE_EXTERNAL_IMAGE2: 1009,
});

const SHAPE_TAGS = new Set([
  SWF_TAG.DEFINE_SHAPE,
  SWF_TAG.DEFINE_SHAPE2,
  SWF_TAG.DEFINE_SHAPE3,
  SWF_TAG.DEFINE_SHAPE4,
]);

/* Определения SWF, первым полем которых идёт номер символа. */
const DEFINITION_TAGS = new Set([
  2, 6, 7, 10, 11, 14, 20, 21, 22, 32, 33, 34, 35, 36, 37, 39, 46, 48, 60, 75,
  83, 84, 87, 90, 91,
]);

/*
 * Теги Scaleform со своим номером в начале. В поиск символов они не идут:
 * у внешнего градиента свой счётчик, и номер 5 градиента затенил бы спрайт 5.
 * Но новые символы их номера занимать не должны.
 */
const SCALEFORM_ID_TAGS = new Set([1001, 1003, 1005, 1008, 1009]);

export function scaleformHeaderLength(buffer) {
  const signature = buffer.subarray(0, 3).toString("ascii");
  if (buffer.length < 16 || !["GFX", "FWS"].includes(signature))
    throw new Error("Файл не похож на Scaleform (нет подписи GFX).");
  const nbits = buffer[8] >> 3;
  return 8 + Math.ceil((5 + nbits * 4) / 8) + 4;
}

/**
 * Несжатый GFX. Штатные файлы игры лежат несжатыми, но авторы модов
 * пересохраняют их и сжатыми (`CFX` — тот же файл под zlib).
 */
export function uncompressedScaleform(buffer) {
  const signature = buffer.subarray(0, 3).toString("ascii");
  if (signature !== "CFX" && signature !== "CWS") {
    scaleformHeaderLength(buffer);
    return buffer;
  }
  const body = zlib.inflateSync(buffer.subarray(8));
  const result = Buffer.concat([
    Buffer.from(signature === "CFX" ? "GFX" : "FWS", "ascii"),
    buffer.subarray(3, 8),
    body,
  ]);
  result.writeUInt32LE(result.length, 4);
  scaleformHeaderLength(result);
  return result;
}

/** Теги подряд в [start, end). Вложенные теги спрайта сюда не входят. */
export function parseSwfTags(buffer, start, end = buffer.length) {
  const result = [];
  let offset = start;
  while (offset + 2 <= end) {
    const raw = buffer.readUInt16LE(offset);
    const code = raw >> 6;
    let length = raw & 63;
    let headerLength = 2;
    if (length === 63) {
      if (offset + 6 > end) throw new Error("SWF: обрезан длинный заголовок тега.");
      length = buffer.readUInt32LE(offset + 2);
      headerLength = 6;
    }
    const payloadStart = offset + headerLength;
    const next = payloadStart + length;
    if (next > end) throw new Error("SWF: тело тега выходит за конец файла.");
    result.push({
      code,
      offset,
      headerLength,
      payloadStart,
      length,
      end: next,
    });
    offset = next;
    if (code === SWF_TAG.END) break;
  }
  return result;
}

export function swfTag(code, payload, forceLong = true) {
  if (!forceLong && payload.length < 63) {
    const header = Buffer.alloc(2);
    header.writeUInt16LE((code << 6) | payload.length);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE((code << 6) | 63);
  header.writeUInt32LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

/* ------------------------------ биты ------------------------------ */

class BitReader {
  constructor(buffer, offset) {
    this.buffer = buffer;
    this.byte = offset;
    this.bit = 0;
  }

  unsigned(bits) {
    let value = 0;
    for (let index = 0; index < bits; index += 1) {
      const current = this.buffer[this.byte];
      if (current === undefined) throw new Error("SWF: битовое поле обрезано.");
      value = value * 2 + ((current >> (7 - this.bit)) & 1);
      this.bit += 1;
      if (this.bit === 8) {
        this.bit = 0;
        this.byte += 1;
      }
    }
    return value;
  }

  signed(bits) {
    if (!bits) return 0;
    const value = this.unsigned(bits);
    const sign = 2 ** (bits - 1);
    return value >= sign ? value - 2 ** bits : value;
  }

  get end() {
    return this.bit ? this.byte + 1 : this.byte;
  }
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.current = 0;
    this.used = 0;
  }

  write(value, bits) {
    let next = BigInt(Math.trunc(value));
    if (next < 0n) next = (1n << BigInt(bits)) + next;
    for (let index = bits - 1; index >= 0; index -= 1) {
      this.current = (this.current << 1) | Number((next >> BigInt(index)) & 1n);
      this.used += 1;
      if (this.used === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.used = 0;
      }
    }
  }

  finish() {
    if (this.used) this.bytes.push(this.current << (8 - this.used));
    return Buffer.from(this.bytes);
  }
}

export function signedBits(value) {
  const number = Math.trunc(value);
  for (let bits = 1; bits <= 31; bits += 1)
    if (number >= -(2 ** (bits - 1)) && number < 2 ** (bits - 1)) return bits;
  return 32;
}

const unsignedBits = (value) => Math.max(1, Math.ceil(Math.log2(value + 1)));

/* ----------------------------- RECT ------------------------------ */

export function readRect(buffer, offset) {
  const reader = new BitReader(buffer, offset);
  const bits = reader.unsigned(5);
  const xmin = reader.signed(bits);
  const xmax = reader.signed(bits);
  const ymin = reader.signed(bits);
  const ymax = reader.signed(bits);
  return { rect: { xmin, xmax, ymin, ymax }, end: reader.end };
}

export function writeRect({ xmin, xmax, ymin, ymax }) {
  const values = [xmin, xmax, ymin, ymax].map((value) => Math.round(value));
  const bits = Math.max(1, ...values.map(signedBits));
  const writer = new BitWriter();
  writer.write(bits, 5);
  for (const value of values) writer.write(value, bits);
  return writer.finish();
}

/* ---------------------------- MATRIX ----------------------------- */

export const IDENTITY_MATRIX = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
});

export function readMatrix(buffer, offset) {
  const reader = new BitReader(buffer, offset);
  const matrix = { ...IDENTITY_MATRIX };
  if (reader.unsigned(1)) {
    const bits = reader.unsigned(5);
    matrix.a = reader.signed(bits) / 65536;
    matrix.d = reader.signed(bits) / 65536;
  }
  if (reader.unsigned(1)) {
    const bits = reader.unsigned(5);
    matrix.b = reader.signed(bits) / 65536;
    matrix.c = reader.signed(bits) / 65536;
  }
  const bits = reader.unsigned(5);
  matrix.tx = reader.signed(bits);
  matrix.ty = reader.signed(bits);
  return { matrix, end: reader.end };
}

export function writeMatrix(matrix = IDENTITY_MATRIX) {
  const fixed = (value) => Math.round(value * 65536);
  const a = fixed(matrix.a ?? 1);
  const d = fixed(matrix.d ?? 1);
  const b = fixed(matrix.b ?? 0);
  const c = fixed(matrix.c ?? 0);
  const tx = Math.round(matrix.tx ?? 0);
  const ty = Math.round(matrix.ty ?? 0);
  const writer = new BitWriter();
  const hasScale = a !== 65536 || d !== 65536;
  writer.write(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const bits = Math.max(signedBits(a), signedBits(d));
    writer.write(bits, 5);
    writer.write(a, bits);
    writer.write(d, bits);
  }
  const hasRotate = b !== 0 || c !== 0;
  writer.write(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const bits = Math.max(signedBits(b), signedBits(c));
    writer.write(bits, 5);
    writer.write(b, bits);
    writer.write(c, bits);
  }
  const bits = tx === 0 && ty === 0 ? 0 : Math.max(signedBits(tx), signedBits(ty));
  writer.write(bits, 5);
  if (bits) {
    writer.write(tx, bits);
    writer.write(ty, bits);
  }
  return writer.finish();
}

/** Масштаб, затем поворот (градусы по часовой), затем сдвиг. */
export function composeMatrix({
  scaleX = 1,
  scaleY = 1,
  rotation = 0,
  translateX = 0,
  translateY = 0,
} = {}) {
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: scaleX * cosine,
    b: scaleX * sine,
    c: -scaleY * sine,
    d: scaleY * cosine,
    tx: translateX,
    ty: translateY,
  };
}

export function multiplyMatrix(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  };
}

export function transformRect(matrix, rect) {
  const corners = [
    [rect.xmin, rect.ymin],
    [rect.xmax, rect.ymin],
    [rect.xmin, rect.ymax],
    [rect.xmax, rect.ymax],
  ].map(([x, y]) => [
    matrix.a * x + matrix.c * y + matrix.tx,
    matrix.b * x + matrix.d * y + matrix.ty,
  ]);
  return {
    xmin: Math.min(...corners.map((corner) => corner[0])),
    xmax: Math.max(...corners.map((corner) => corner[0])),
    ymin: Math.min(...corners.map((corner) => corner[1])),
    ymax: Math.max(...corners.map((corner) => corner[1])),
  };
}

/* ----------------------------- CXFORM ---------------------------- */

export function readColorTransform(buffer, offset) {
  const reader = new BitReader(buffer, offset);
  const hasAdd = reader.unsigned(1);
  const hasMult = reader.unsigned(1);
  const bits = reader.unsigned(4);
  const mult = [256, 256, 256, 256];
  const add = [0, 0, 0, 0];
  if (hasMult) for (let index = 0; index < 4; index += 1) mult[index] = reader.signed(bits);
  if (hasAdd) for (let index = 0; index < 4; index += 1) add[index] = reader.signed(bits);
  return { cxform: { mult, add }, end: reader.end };
}

/**
 * Преобразование цвета с альфой. Множители — в 1/256, прибавки — в 0…255.
 */
export function writeColorTransform({
  mult = [256, 256, 256, 256],
  add = [0, 0, 0, 0],
} = {}) {
  const multiply = mult.map((value) => Math.round(value));
  const plus = add.map((value) => Math.round(value));
  const hasMult = multiply.some((value) => value !== 256);
  const hasAdd = plus.some((value) => value !== 0);
  const terms = [...(hasMult ? multiply : []), ...(hasAdd ? plus : [])];
  const bits = terms.length ? Math.max(...terms.map(signedBits)) : 1;
  if (bits > 15) throw new RangeError("SWF: множитель цвета вне диапазона.");
  const writer = new BitWriter();
  writer.write(hasAdd ? 1 : 0, 1);
  writer.write(hasMult ? 1 : 0, 1);
  writer.write(bits, 4);
  if (hasMult) for (const value of multiply) writer.write(value, bits);
  if (hasAdd) for (const value of plus) writer.write(value, bits);
  return writer.finish();
}

/** Цвет «умножением»: белое становится цветом, чёрная обводка остаётся. */
export const multiplyColor = ([red, green, blue], alpha = 255) => ({
  mult: [red, green, blue, alpha].map((channel) =>
    Math.round((Math.max(0, Math.min(255, channel)) * 256) / 255),
  ),
  add: [0, 0, 0, 0],
});

/** Сплошной цвет: картинка становится силуэтом этого цвета. */
export const solidColor = ([red, green, blue], alpha = 255) => ({
  mult: [0, 0, 0, Math.round((Math.max(0, Math.min(255, alpha)) * 256) / 255)],
  add: [red, green, blue, 0].map((channel) =>
    Math.round(Math.max(0, Math.min(255, channel))),
  ),
});

export const alphaOnly = (alpha) => ({
  mult: [256, 256, 256, Math.round((Math.max(0, Math.min(255, alpha)) * 256) / 255)],
  add: [0, 0, 0, 0],
});

/* ------------------------- PlaceObject2/3 ------------------------ */

const readString = (buffer, offset, end) => {
  const zero = buffer.indexOf(0, offset);
  if (zero < 0 || zero >= end) throw new Error("SWF: строка не закрыта нулём.");
  return { value: buffer.toString("utf8", offset, zero), end: zero + 1 };
};

/** Размещение из PlaceObject2 или PlaceObject3 (без фильтров и действий). */
export function readPlacement(buffer, tag) {
  const end = tag.end;
  let offset = tag.payloadStart;
  if (tag.code === SWF_TAG.PLACE_OBJECT2) {
    const flags = buffer[offset];
    offset += 1;
    const placement = {
      code: tag.code,
      flags,
      move: Boolean(flags & 0x01),
      depth: buffer.readUInt16LE(offset),
    };
    offset += 2;
    if (flags & 0x02) {
      placement.characterId = buffer.readUInt16LE(offset);
      offset += 2;
    }
    if (flags & 0x04) {
      const read = readMatrix(buffer, offset);
      placement.matrix = read.matrix;
      offset = read.end;
    }
    if (flags & 0x08) {
      const read = readColorTransform(buffer, offset);
      placement.cxform = read.cxform;
      offset = read.end;
    }
    if (flags & 0x10) {
      placement.ratio = buffer.readUInt16LE(offset);
      offset += 2;
    }
    if (flags & 0x20) {
      const read = readString(buffer, offset, end);
      placement.name = read.value;
      offset = read.end;
    }
    if (flags & 0x40) placement.clipDepth = buffer.readUInt16LE(offset);
    return placement;
  }
  if (tag.code === SWF_TAG.PLACE_OBJECT3) {
    const flags = buffer[offset];
    const flags2 = buffer[offset + 1];
    offset += 2;
    const placement = {
      code: tag.code,
      flags,
      flags2,
      move: Boolean(flags & 0x01),
      depth: buffer.readUInt16LE(offset),
    };
    offset += 2;
    if (flags2 & 0x08 || (flags2 & 0x10 && flags & 0x02)) {
      const read = readString(buffer, offset, end);
      placement.className = read.value;
      offset = read.end;
    }
    if (flags & 0x02) {
      placement.characterId = buffer.readUInt16LE(offset);
      offset += 2;
    }
    if (flags & 0x04) {
      const read = readMatrix(buffer, offset);
      placement.matrix = read.matrix;
      offset = read.end;
    }
    if (flags & 0x08) {
      const read = readColorTransform(buffer, offset);
      placement.cxform = read.cxform;
      offset = read.end;
    }
    if (flags & 0x10) {
      placement.ratio = buffer.readUInt16LE(offset);
      offset += 2;
    }
    if (flags & 0x20) {
      const read = readString(buffer, offset, end);
      placement.name = read.value;
    }
    return placement;
  }
  return null;
}

/**
 * Размещение PlaceObject2. `move` — сдвиг того, что уже стоит на глубине
 * (кадры анимации): символ тогда можно не называть. `clipDepth` — маска:
 * фигура не рисуется, а открывает глубины над собой до `clipDepth`
 * включительно.
 */
export function placeObject2({
  depth,
  characterId = null,
  matrix = null,
  cxform = null,
  name = "",
  clipDepth = 0,
  move = false,
}) {
  const hasCharacter = characterId !== null && characterId !== undefined;
  const flags =
    (move ? 0x01 : 0) |
    (hasCharacter ? 0x02 : 0) |
    (matrix ? 0x04 : 0) |
    (cxform ? 0x08 : 0) |
    (name ? 0x20 : 0) |
    (clipDepth ? 0x40 : 0);
  const fixed = Buffer.alloc(hasCharacter ? 5 : 3);
  fixed[0] = flags;
  fixed.writeUInt16LE(depth, 1);
  if (hasCharacter) fixed.writeUInt16LE(characterId, 3);
  const chunks = [fixed];
  if (matrix) chunks.push(writeMatrix(matrix));
  if (cxform) chunks.push(writeColorTransform(cxform));
  if (name) chunks.push(Buffer.from(`${name}\0`, "utf8"));
  if (clipDepth) {
    const clip = Buffer.alloc(2);
    clip.writeUInt16LE(clipDepth);
    chunks.push(clip);
  }
  return swfTag(SWF_TAG.PLACE_OBJECT2, Buffer.concat(chunks));
}

/* ---------------------------- символы ---------------------------- */

export function defineSprite(id, children, frameCount = 1) {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id, 0);
  header.writeUInt16LE(frameCount, 2);
  return swfTag(
    SWF_TAG.DEFINE_SPRITE,
    Buffer.concat([
      header,
      ...children,
      swfTag(SWF_TAG.SHOW_FRAME, Buffer.alloc(0), false),
      swfTag(SWF_TAG.END, Buffer.alloc(0), false),
    ]),
  );
}

/**
 * Сетка масштабирования (9-slice, DefineScalingGrid): после неё `_width` и
 * `_height` спрайта растягивают только середину между линиями сетки, а углы
 * остаются как нарисованы. Тег идёт после определения спрайта `characterId`;
 * `grid` — середина в твипах спрайта: `{ xmin, xmax, ymin, ymax }`.
 * Hud.gfx игры сам пользуется этим тегом (два спрайта).
 */
export function defineScalingGrid(characterId, grid) {
  const id = Buffer.alloc(2);
  id.writeUInt16LE(characterId);
  return swfTag(SWF_TAG.DEFINE_SCALING_GRID, Buffer.concat([id, writeRect(grid)]));
}

/**
 * Спрайт из нескольких кадров: `frames` — теги каждого кадра (размещения,
 * сдвиги), после каждого — ShowFrame. Спрайт крутится по кругу сам: так
 * устроены мигающие точки самой мини-карты (до шестидесяти кадров).
 */
export function defineSpriteFrames(id, frames) {
  if (!frames.length) throw new RangeError("SWF: у спрайта нет кадров.");
  if (frames.length > 0xffff) throw new RangeError("SWF: слишком много кадров.");
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id, 0);
  header.writeUInt16LE(frames.length, 2);
  const show = swfTag(SWF_TAG.SHOW_FRAME, Buffer.alloc(0), false);
  return swfTag(
    SWF_TAG.DEFINE_SPRITE,
    Buffer.concat([
      header,
      ...frames.flatMap((tags) => [...tags, show]),
      swfTag(SWF_TAG.END, Buffer.alloc(0), false),
    ]),
  );
}

/**
 * Прямоугольник `rect` (твипы), залитый растром без повтора и со
 * сглаживанием (0x41): `fill` — матрица заливки, точка растра → твипы
 * фигуры. Растр крупнее фигуры просто обрезан ею — так лист кадров видео
 * открывается по одному кадру.
 */
export function defineBitmapRectShape(id, bitmapId, rect, fill) {
  const left = Math.round(rect.x);
  const top = Math.round(rect.y);
  const right = Math.round(rect.x + rect.width);
  const bottom = Math.round(rect.y + rect.height);
  if (!(right > left && bottom > top))
    throw new RangeError("SWF: у фигуры с растром нет площади.");
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const bitmap = Buffer.alloc(2);
  bitmap.writeUInt16LE(bitmapId);
  const fills = Buffer.concat([
    Buffer.from([1, 0x41]),
    bitmap,
    writeMatrix(fill),
    Buffer.from([0]),
  ]);
  const writer = new BitWriter();
  writer.write(1, 4); // NumFillBits
  writer.write(0, 4); // NumLineBits
  writer.write(0, 1);
  writer.write(0, 1); // StateNewStyles
  writer.write(0, 1); // StateLineStyle
  writer.write(1, 1); // StateFillStyle1
  writer.write(0, 1); // StateFillStyle0
  writer.write(1, 1); // StateMoveTo
  const moveBits = Math.max(signedBits(left), signedBits(top));
  writer.write(moveBits, 5);
  writer.write(left, moveBits);
  writer.write(top, moveBits);
  writer.write(1, 1); // FillStyle1 = 1
  for (const [dx, dy] of [
    [right - left, 0],
    [0, bottom - top],
    [left - right, 0],
    [0, top - bottom],
  ]) {
    const bits = Math.max(2, signedBits(dx), signedBits(dy));
    writer.write(1, 1); // edge
    writer.write(1, 1); // straight
    writer.write(bits - 2, 4);
    writer.write(1, 1); // general line
    writer.write(dx, bits);
    writer.write(dy, bits);
  }
  writer.write(0, 6); // EndShapeRecord
  return swfTag(
    SWF_TAG.DEFINE_SHAPE3,
    Buffer.concat([
      idBuffer,
      writeRect({ xmin: left, xmax: right, ymin: top, ymax: bottom }),
      fills,
      writer.finish(),
    ]),
  );
}

/**
 * Несколько сплошных прямоугольников одной заливкой (DefineShape3 — цвет с
 * альфой): рамка из четырёх линий — одна фигура, а не четыре символа.
 *
 * Прямоугольники не должны перекрываться: заливка во Flash чётно-нечётная, и
 * общая площадь двух контуров одной заливки стала бы дырой. Вырожденные
 * (меньше твипа по стороне) пропускаются.
 */
export function defineRectanglesShape(id, rectangles, [red, green, blue, alpha]) {
  const boxes = rectangles
    .map(({ x, y, width, height }) => ({
      left: Math.round(x),
      top: Math.round(y),
      right: Math.round(x + width),
      bottom: Math.round(y + height),
    }))
    .filter((box) => box.right > box.left && box.bottom > box.top);
  if (!boxes.length)
    throw new RangeError("SWF: у фигуры нет ни одного прямоугольника.");
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const fills = Buffer.from([1, 0x00, red, green, blue, alpha, 0]);
  const writer = new BitWriter();
  writer.write(1, 4); // NumFillBits
  writer.write(0, 4); // NumLineBits
  boxes.forEach(({ left, top, right, bottom }, index) => {
    /* StyleChangeRecord: сдвиг в левый верхний угол; заливка 1 выбирается
       один раз и держится до конца фигуры. */
    writer.write(0, 1);
    writer.write(0, 1); // StateNewStyles
    writer.write(0, 1); // StateLineStyle
    writer.write(index === 0 ? 1 : 0, 1); // StateFillStyle1
    writer.write(0, 1); // StateFillStyle0
    writer.write(1, 1); // StateMoveTo
    const moveBits = Math.max(signedBits(left), signedBits(top));
    writer.write(moveBits, 5);
    writer.write(left, moveBits);
    writer.write(top, moveBits);
    if (index === 0) writer.write(1, 1); // FillStyle1 = 1
    const edges = [
      [right - left, 0],
      [0, bottom - top],
      [left - right, 0],
      [0, top - bottom],
    ];
    for (const [dx, dy] of edges) {
      writer.write(1, 1); // edge
      writer.write(1, 1); // straight
      const bits = Math.max(2, signedBits(dx), signedBits(dy));
      writer.write(bits - 2, 4);
      writer.write(1, 1); // general line
      writer.write(dx, bits);
      writer.write(dy, bits);
    }
  });
  writer.write(0, 6); // EndShapeRecord
  return swfTag(
    SWF_TAG.DEFINE_SHAPE3,
    Buffer.concat([
      idBuffer,
      writeRect({
        xmin: Math.min(...boxes.map((box) => box.left)),
        xmax: Math.max(...boxes.map((box) => box.right)),
        ymin: Math.min(...boxes.map((box) => box.top)),
        ymax: Math.max(...boxes.map((box) => box.bottom)),
      }),
      fills,
      writer.finish(),
    ]),
  );
}

/** Сплошной прямоугольник (DefineShape3 — цвет с альфой). */
export function defineRectangleShape(id, rectangle, fill) {
  return defineRectanglesShape(id, [rectangle], fill);
}

/**
 * Фигура из многоугольников одной заливки (DefineShape3): `polygons` —
 * `[[x, y]…]` в твипах, каждый замыкается в свою первую точку. Как и у
 * прямоугольников, контуры не должны перекрываться — общая площадь стала
 * бы дырой. Значок патронов счётчика (`hud-ammo-gfx-compiler.js`).
 */
export function definePolygonsShape(id, polygons, [red, green, blue, alpha]) {
  const contours = polygons
    .map((points) => points.map(([x, y]) => [Math.round(x), Math.round(y)]))
    .filter((points) => points.length >= 3);
  if (!contours.length)
    throw new RangeError("SWF: у фигуры нет ни одного многоугольника.");
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const fills = Buffer.from([1, 0x00, red, green, blue, alpha, 0]);
  const writer = new BitWriter();
  writer.write(1, 4); // NumFillBits
  writer.write(0, 4); // NumLineBits
  contours.forEach((points, index) => {
    const [startX, startY] = points[0];
    writer.write(0, 1);
    writer.write(0, 1); // StateNewStyles
    writer.write(0, 1); // StateLineStyle
    writer.write(index === 0 ? 1 : 0, 1); // StateFillStyle1
    writer.write(0, 1); // StateFillStyle0
    writer.write(1, 1); // StateMoveTo
    const moveBits = Math.max(signedBits(startX), signedBits(startY));
    writer.write(moveBits, 5);
    writer.write(startX, moveBits);
    writer.write(startY, moveBits);
    if (index === 0) writer.write(1, 1); // FillStyle1 = 1
    let previous = points[0];
    for (const point of [...points.slice(1), points[0]]) {
      const dx = point[0] - previous[0];
      const dy = point[1] - previous[1];
      if (!dx && !dy) continue;
      writer.write(1, 1); // edge
      writer.write(1, 1); // straight
      const bits = Math.max(2, signedBits(dx), signedBits(dy));
      writer.write(bits - 2, 4);
      writer.write(1, 1); // general line
      writer.write(dx, bits);
      writer.write(dy, bits);
      previous = point;
    }
  });
  writer.write(0, 6); // EndShapeRecord
  const xs = contours.flat().map(([x]) => x);
  const ys = contours.flat().map(([, y]) => y);
  return swfTag(
    SWF_TAG.DEFINE_SHAPE3,
    Buffer.concat([
      idBuffer,
      writeRect({
        xmin: Math.min(...xs),
        xmax: Math.max(...xs),
        ymin: Math.min(...ys),
        ymax: Math.max(...ys),
      }),
      fills,
      writer.finish(),
    ]),
  );
}

/**
 * Растр DefineBitsLossless2: ARGB построчно под zlib. Альфа в SWF
 * предумножена не должна быть — Scaleform, как и Flash, читает её прямой.
 */
export function defineLosslessBitmap(id, { width, height, rgba }) {
  const pixels = Buffer.alloc(rgba.length);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    pixels[offset] = rgba[offset + 3];
    pixels[offset + 1] = rgba[offset];
    pixels[offset + 2] = rgba[offset + 1];
    pixels[offset + 3] = rgba[offset + 2];
  }
  const header = Buffer.alloc(7);
  header.writeUInt16LE(id, 0);
  header[2] = 5;
  header.writeUInt16LE(width, 3);
  header.writeUInt16LE(height, 5);
  return swfTag(
    SWF_TAG.DEFINE_BITS_LOSSLESS2,
    Buffer.concat([header, zlib.deflateSync(pixels)]),
  );
}

/**
 * Квадрат `side`×`side` твипов с началом в (0, 0), залитый растром без
 * повтора. Где он встанет и какого будет размера, решает размещение.
 */
export function defineBitmapShape(id, bitmapId, imageWidth, imageHeight, side = 1280) {
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const bitmap = Buffer.alloc(2);
  bitmap.writeUInt16LE(bitmapId);
  const fills = Buffer.concat([
    Buffer.from([1, 0x41]),
    bitmap,
    writeMatrix({
      a: side / imageWidth,
      b: 0,
      c: 0,
      d: side / imageHeight,
      tx: 0,
      ty: 0,
    }),
    Buffer.from([0]),
  ]);
  const writer = new BitWriter();
  writer.write(1, 4);
  writer.write(0, 4);
  writer.write(0, 1);
  writer.write(0, 1);
  writer.write(0, 1);
  writer.write(1, 1);
  writer.write(0, 1);
  writer.write(1, 1);
  writer.write(2, 5);
  writer.write(0, 2);
  writer.write(0, 2);
  writer.write(1, 1);
  for (const [dx, dy] of [
    [side, 0],
    [0, side],
    [-side, 0],
    [0, -side],
  ]) {
    const bits = Math.max(2, signedBits(dx), signedBits(dy));
    writer.write(1, 1);
    writer.write(1, 1);
    writer.write(bits - 2, 4);
    writer.write(1, 1);
    writer.write(dx, bits);
    writer.write(dy, bits);
  }
  writer.write(0, 6);
  return swfTag(
    SWF_TAG.DEFINE_SHAPE3,
    Buffer.concat([
      idBuffer,
      writeRect({ xmin: 0, xmax: side, ymin: 0, ymax: side }),
      fills,
      writer.finish(),
    ]),
  );
}

/**
 * Квадрат со стороной `side` твипов с центром в (0, 0), залитый картинкой
 * без повтора и со сглаживанием (0x41), — DefineShape, как у картинок самой
 * игры: так устроены `busy_spinner.gfx` и иконки оружия в `hud.gfx` (заливка
 * по внешней картинке словаря, `DefineExternalImage2`). Центр в нуле — чтобы
 * поворот и масштаб размещения шли вокруг середины картинки.
 */
export function defineCentredBitmapShape(
  id,
  bitmapId,
  imageWidth,
  imageHeight,
  side,
) {
  const half = Math.round(side / 2);
  const full = half * 2;
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const bitmap = Buffer.alloc(2);
  bitmap.writeUInt16LE(bitmapId);
  const fills = Buffer.concat([
    Buffer.from([1, 0x41]),
    bitmap,
    writeMatrix({
      a: full / imageWidth,
      b: 0,
      c: 0,
      d: full / imageHeight,
      tx: -half,
      ty: -half,
    }),
    Buffer.from([0]),
  ]);
  const writer = new BitWriter();
  writer.write(1, 4); // NumFillBits
  writer.write(0, 4); // NumLineBits
  /* StyleChangeRecord: заливка 0 и переход в левый нижний угол — порядок
     рёбер тот же, что у штатного квадрата `busy_spinner.gfx`. */
  writer.write(0, 1);
  writer.write(0, 1); // StateNewStyles
  writer.write(0, 1); // StateLineStyle
  writer.write(0, 1); // StateFillStyle1
  writer.write(1, 1); // StateFillStyle0
  writer.write(1, 1); // StateMoveTo
  const moveBits = Math.max(signedBits(-half), signedBits(half));
  writer.write(moveBits, 5);
  writer.write(-half, moveBits);
  writer.write(half, moveBits);
  writer.write(1, 1); // FillStyle0 = 1
  for (const [dx, dy] of [
    [full, 0],
    [0, -full],
    [-full, 0],
    [0, full],
  ]) {
    const bits = Math.max(2, signedBits(dx), signedBits(dy));
    writer.write(1, 1); // edge
    writer.write(1, 1); // straight
    writer.write(bits - 2, 4);
    writer.write(1, 1); // general line
    writer.write(dx, bits);
    writer.write(dy, bits);
  }
  writer.write(0, 6); // EndShapeRecord
  return swfTag(
    SWF_TAG.DEFINE_SHAPE,
    Buffer.concat([
      idBuffer,
      writeRect({ xmin: -half, xmax: half, ymin: -half, ymax: half }),
      fills,
      writer.finish(),
    ]),
  );
}

/**
 * Внешняя картинка Scaleform (`DefineExternalImage2`, тег 1009): растр не в
 * файле, а в словаре текстур фильма (`hud_reticle.ytd` у `hud_reticle.gfx`),
 * по имени. Так хранит картинки каждый фильм игры — встроенных растров нет
 * ни в одном из четырёхсот `.gfx` update.rpf. Поля — как у штатных записей:
 * номер символа (UI32, старшая половина — тип номера, у игры ноль), формат
 * 14, исходный размер, имя экспорта и имя файла `<имя>.dds`, пустой хвост.
 */
export function defineExternalImage(id, { name, width, height }) {
  const exportName = Buffer.from(String(name), "latin1");
  const fileName = Buffer.from(`${name}.dds`, "latin1");
  if (!/^[a-z0-9_]{1,64}$/.test(String(name)))
    throw new RangeError("SWF: имя внешней картинки — латиница, цифры и _.");
  const head = Buffer.alloc(10);
  head.writeUInt32LE(id, 0);
  head.writeUInt16LE(14, 4);
  head.writeUInt16LE(width, 6);
  head.writeUInt16LE(height, 8);
  return swfTag(
    SCALEFORM_TAG.DEFINE_EXTERNAL_IMAGE2,
    Buffer.concat([
      head,
      Buffer.from([exportName.length]),
      exportName,
      Buffer.from([fileName.length]),
      fileName,
      Buffer.from([0]),
    ]),
  );
}

/**
 * Динамическое текстовое поле. Шрифт — из библиотеки шрифтов игры
 * (`ImportAssets2` из gfxfontlib.swf), поэтому глифы берутся оттуда
 * (`useOutlines`), и текст в игре выглядит так же, как остальной HUD.
 */
export function defineEditText({
  id,
  bounds,
  fontId,
  fontHeight,
  color: [red, green, blue, alpha = 255],
  align = 2,
  text = "",
}) {
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const hasText = text !== "";
  const flags1 =
    (hasText ? 0x80 : 0) | 0x08 /* ReadOnly */ | 0x04 /* HasTextColor */ | 0x01; /* HasFont */
  const flags2 = 0x20 /* HasLayout */ | 0x10 /* NoSelect */ | 0x01; /* UseOutlines */
  const font = Buffer.alloc(4);
  font.writeUInt16LE(fontId, 0);
  font.writeUInt16LE(Math.round(fontHeight), 2);
  const layout = Buffer.alloc(9);
  layout[0] = align;
  layout.writeUInt16LE(0, 1);
  layout.writeUInt16LE(0, 3);
  layout.writeUInt16LE(0, 5);
  layout.writeInt16LE(0, 7);
  return swfTag(
    SWF_TAG.DEFINE_EDIT_TEXT,
    Buffer.concat([
      idBuffer,
      writeRect(bounds),
      Buffer.from([flags1, flags2]),
      font,
      Buffer.from([red, green, blue, alpha]),
      layout,
      Buffer.from("\0", "utf8"),
      ...(hasText ? [Buffer.from(`${text}\0`, "utf8")] : []),
    ]),
  );
}

/* --------------------------- оглавление -------------------------- */

/**
 * Оглавление файла: определения по номеру, экспорт и импорт по имени.
 */
export function indexSwf(buffer) {
  const headerLength = scaleformHeaderLength(buffer);
  const tags = parseSwfTags(buffer, headerLength);
  const definitions = new Map();
  const usedIds = new Set();
  const exports = new Map();
  const imports = new Map();
  for (const tag of tags) {
    if (
      (DEFINITION_TAGS.has(tag.code) || SCALEFORM_ID_TAGS.has(tag.code)) &&
      tag.length >= 2
    ) {
      const id = buffer.readUInt16LE(tag.payloadStart);
      usedIds.add(id);
      if (DEFINITION_TAGS.has(tag.code) && !definitions.has(id))
        definitions.set(id, tag);
    }
    if (tag.code === SWF_TAG.EXPORT_ASSETS) {
      const count = buffer.readUInt16LE(tag.payloadStart);
      let offset = tag.payloadStart + 2;
      for (let index = 0; index < count; index += 1) {
        const id = buffer.readUInt16LE(offset);
        const name = readString(buffer, offset + 2, tag.end);
        if (!exports.has(name.value)) exports.set(name.value, id);
        offset = name.end;
      }
    }
    if (tag.code === SWF_TAG.IMPORT_ASSETS2) {
      const url = readString(buffer, tag.payloadStart, tag.end);
      let offset = url.end + 2; // reserved: 1, 0
      const count = buffer.readUInt16LE(offset);
      offset += 2;
      for (let index = 0; index < count; index += 1) {
        const id = buffer.readUInt16LE(offset);
        const name = readString(buffer, offset + 2, tag.end);
        usedIds.add(id);
        if (!imports.has(name.value))
          imports.set(name.value, { id, url: url.value });
        offset = name.end;
      }
    }
  }
  return { buffer, headerLength, tags, definitions, usedIds, exports, imports };
}

/** Теги первого кадра спрайта с разобранными размещениями. */
export function spriteTimeline(buffer, spriteTag) {
  if (spriteTag.code !== SWF_TAG.DEFINE_SPRITE)
    throw new TypeError("SWF: это не спрайт.");
  const tags = parseSwfTags(buffer, spriteTag.payloadStart + 4, spriteTag.end);
  return tags.map((tag) => ({
    ...tag,
    placement:
      tag.code === SWF_TAG.PLACE_OBJECT2 || tag.code === SWF_TAG.PLACE_OBJECT3
        ? readPlacement(buffer, tag)
        : null,
  }));
}

/** Размещения первого кадра спрайта (до первого ShowFrame). */
export function spritePlacements(buffer, spriteTag) {
  const placements = [];
  for (const tag of spriteTimeline(buffer, spriteTag)) {
    if (tag.code === SWF_TAG.SHOW_FRAME) break;
    if (tag.placement?.characterId !== undefined) placements.push(tag.placement);
  }
  return placements;
}

/**
 * Габарит символа в его координатах, в твипах: фигуры и поля — по RECT,
 * спрайт — по первому кадру с матрицами размещений. Нужен, чтобы найти
 * прямоугольник радара по `wantedOverlaySP`, а не записывать его числом.
 */
export function characterBounds(index, id, seen = new Set()) {
  if (seen.has(id)) return null;
  const tag = index.definitions.get(id);
  if (!tag) return null;
  const { buffer } = index;
  if (SHAPE_TAGS.has(tag.code) || tag.code === SWF_TAG.DEFINE_EDIT_TEXT)
    return readRect(buffer, tag.payloadStart + 2).rect;
  if (tag.code !== SWF_TAG.DEFINE_SPRITE) return null;
  const next = new Set(seen).add(id);
  let result = null;
  for (const placement of spritePlacements(buffer, tag)) {
    const child = characterBounds(index, placement.characterId, next);
    if (!child) continue;
    const rect = transformRect(placement.matrix || IDENTITY_MATRIX, child);
    result = result
      ? {
          xmin: Math.min(result.xmin, rect.xmin),
          xmax: Math.max(result.xmax, rect.xmax),
          ymin: Math.min(result.ymin, rect.ymin),
          ymax: Math.max(result.ymax, rect.ymax),
        }
      : rect;
  }
  return result;
}

/*
 * Фигура из прямоугольников сплошных заливок — как её записал Rockstar.
 *
 * Нужна там, где в одной фигуре игры лежат две разные вещи и одну из них надо
 * убрать, а вторую оставить: у развёрнутого радара (`HEALTH_ARMOUR_ABILITY_BIG`)
 * светлая плёнка поверх карты и чёрная лента под штатными полосами — одна
 * фигура с двумя наборами стилей (2 ноября 2026, разбор minimap.gfx Steam Legacy).
 */
function readFillStyles(buffer, offset, code) {
  let count = buffer[offset];
  offset += 1;
  if (count === 0xff) {
    count = buffer.readUInt16LE(offset);
    offset += 2;
  }
  const fills = [];
  const rgba = code !== SWF_TAG.DEFINE_SHAPE && code !== SWF_TAG.DEFINE_SHAPE2;
  for (let index = 0; index < count; index += 1) {
    if (buffer[offset] !== 0x00) return null;
    const color = [...buffer.subarray(offset + 1, offset + (rgba ? 5 : 4))];
    fills.push(rgba ? color : [...color, 255]);
    offset += rgba ? 5 : 4;
  }
  let lines = buffer[offset];
  offset += 1;
  if (lines === 0xff) {
    lines = buffer.readUInt16LE(offset);
    offset += 2;
  }
  offset += lines * (rgba ? 6 : 5);
  const bits = buffer[offset];
  return { fills, fillBits: bits >> 4, lineBits: bits & 15, end: offset + 1 };
}

/**
 * Прямоугольники фигуры `[{ x, y, width, height, fill: [r, g, b, a] }]` в
 * твипах. `null` — фигура не из одних прямых осевых прямоугольников сплошной
 * заливки (градиент, картинка, кривая, линия): такую не перебрать без потерь.
 */
export function readShapeRectangles(buffer, tag) {
  if (!SHAPE_TAGS.has(tag?.code) || tag.code === SWF_TAG.DEFINE_SHAPE4) return null;
  const bounds = readRect(buffer, tag.payloadStart + 2);
  let styles = readFillStyles(buffer, bounds.end, tag.code);
  if (!styles) return null;
  const reader = new BitReader(buffer, styles.end);
  const rectangles = [];
  let x = 0;
  let y = 0;
  let fill = null;
  let path = null;
  const close = () => {
    if (!path) return true;
    const points = path.points;
    path = null;
    /* Переход без единой кромки (смена стилей, сдвиг пера) — не контур. */
    if (points.length === 1) return true;
    if (points.length !== 5) return false;
    const [first] = points;
    const last = points[4];
    if (first[0] !== last[0] || first[1] !== last[1]) return false;
    for (let index = 1; index < 5; index += 1) {
      const [ax, ay] = points[index - 1];
      const [bx, by] = points[index];
      if (ax !== bx && ay !== by) return false;
    }
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    if (!fill) return true;
    rectangles.push({
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      fill,
    });
    return true;
  };
  for (;;) {
    if (reader.byte >= tag.end) return null;
    if (!reader.unsigned(1)) {
      const flags = reader.unsigned(5);
      if (!flags) break;
      if (!close()) return null;
      let fill0 = 0;
      let fill1 = 0;
      if (flags & 1) {
        const bits = reader.unsigned(5);
        x = reader.signed(bits);
        y = reader.signed(bits);
      }
      if (flags & 2) fill0 = reader.unsigned(styles.fillBits);
      if (flags & 4) fill1 = reader.unsigned(styles.fillBits);
      if (flags & 8 && reader.unsigned(styles.lineBits)) return null;
      if (flags & 16) {
        styles = readFillStyles(buffer, reader.end, tag.code);
        if (!styles) return null;
        reader.byte = styles.end;
        reader.bit = 0;
      }
      if (fill0 && fill1) return null;
      const chosen = fill1 || fill0;
      fill = chosen ? styles.fills[chosen - 1] || null : flags & 6 ? null : fill;
      path = { points: [[x, y]] };
      continue;
    }
    if (!reader.unsigned(1)) return null;
    const bits = reader.unsigned(4) + 2;
    const general = reader.unsigned(1);
    const vertical = general ? 0 : reader.unsigned(1);
    if (general) {
      x += reader.signed(bits);
      y += reader.signed(bits);
    } else if (vertical) y += reader.signed(bits);
    else x += reader.signed(bits);
    if (!path) path = { points: [[x, y]] };
    else path.points.push([x, y]);
  }
  return close() ? rectangles : null;
}

/**
 * Свободные номера символов для новых определений: сверху вниз от 65000,
 * мимо всех занятых. Номера детерминированы — один и тот же файл и одни и те
 * же настройки дают байт в байт одинаковый пакет.
 */
export function allocateCharacterIds(index, count, from = 65000) {
  const ids = [];
  for (let id = from; id > 0 && ids.length < count; id -= 1)
    if (!index.usedIds.has(id)) ids.push(id);
  if (ids.length < count) throw new Error("SWF: нет свободных номеров символов.");
  return ids;
}

export { unsignedBits };
