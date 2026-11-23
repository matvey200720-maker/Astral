/*
 * AVM1 — байт-код ActionScript 2 внутри Scaleform-файлов игры.
 *
 * Мини-карта GTA V — это SWF в обёртке GFX, и поведение полос здоровья и
 * брони записано не в кадрах, а в классе `MINIMAP`: какой цвет взять, с какого
 * процента полоса краснеет, насколько ярко мигает урон. Поменять это можно
 * только правкой самого байт-кода.
 *
 * Раньше компилятор искал в файле точные байты и потому был привязан к одной
 * копии minimap.gfx, уже пересобранной чужим редактором: тот раскладывал Push
 * по одному значению и держал свой порядок строк в пуле. В игре игрока Push
 * упакованы по нескольку значений, пул другой — и ни одна «проверенная»
 * последовательность в настоящем файле не находилась. Здесь байт-код читается
 * как действия: пул строк, значения Push, границы функций, — и правка
 * задаётся по смыслу («Push register1, "colourHealth"»), а не смещением.
 *
 * Длина правки может отличаться от исходной. Переходы (`If`, `Jump`) и размеры
 * блоков (тела функций, `With`, `Try`), через которые она проходит,
 * пересчитываются; переход в середину заменённого куска — отказ, а не
 * догадка: такой код нельзя переписать, не зная, что он делает.
 */

export const AVM1 = Object.freeze({
  END: 0x00,
  NOT: 0x12,
  POP: 0x17,
  GET_VARIABLE: 0x1c,
  INIT_ARRAY: 0x42,
  INIT_OBJECT: 0x43,
  LESS2: 0x48,
  GET_MEMBER: 0x4e,
  SET_MEMBER: 0x4f,
  CALL_METHOD: 0x52,
  GREATER: 0x67,
  STORE_REGISTER: 0x87,
  CONSTANT_POOL: 0x88,
  WAIT_FOR_FRAME: 0x8a,
  WAIT_FOR_FRAME2: 0x8d,
  DEFINE_FUNCTION2: 0x8e,
  TRY: 0x8f,
  WITH: 0x94,
  PUSH: 0x96,
  JUMP: 0x99,
  DEFINE_FUNCTION: 0x9b,
  IF: 0x9d,
});

const PUSH_TYPE = Object.freeze({
  STRING: 0,
  FLOAT: 1,
  NULL: 2,
  UNDEFINED: 3,
  REGISTER: 4,
  BOOLEAN: 5,
  DOUBLE: 6,
  INTEGER: 7,
  CONSTANT8: 8,
  CONSTANT16: 9,
});

const hex = (value) => `0x${value.toString(16).padStart(2, "0")}`;

/** Регистр в значениях Push: `{ register: 1 }`, чтобы не спутать с числом. */
export const register = (index) => Object.freeze({ register: index });

/**
 * Действия подряд, как они лежат в потоке. Тела функций в AVM1 не вложены
 * физически — они идут следом за заголовком `DefineFunction2`, поэтому один
 * линейный проход видит все действия файла, а границы блоков считаются
 * отдельно (`blockSpans`).
 */
export function parseActions(buffer, start = 0, end = buffer.length) {
  const records = [];
  let offset = start;
  while (offset < end) {
    const code = buffer[offset];
    let size = 1;
    let bodyStart = offset + 1;
    let bodyLength = 0;
    if (code >= 0x80) {
      if (offset + 3 > end)
        throw new Error(
          `AVM1: заголовок действия ${hex(code)} обрезан на ${offset}.`,
        );
      bodyLength = buffer.readUInt16LE(offset + 1);
      bodyStart = offset + 3;
      size = 3 + bodyLength;
      if (offset + size > end)
        throw new Error(`AVM1: действие ${hex(code)} выходит за конец потока.`);
    }
    records.push({
      index: records.length,
      offset,
      end: offset + size,
      code,
      size,
      bodyStart,
      bodyLength,
    });
    offset += size;
  }
  return records;
}

/** Строки пула `ConstantPool`: индекс в Push типа 8/9 — индекс в этом списке. */
export function readConstantPool(buffer, record) {
  if (record.code !== AVM1.CONSTANT_POOL)
    throw new TypeError("AVM1: это не ConstantPool.");
  const end = record.bodyStart + record.bodyLength;
  const count = buffer.readUInt16LE(record.bodyStart);
  const strings = [];
  let offset = record.bodyStart + 2;
  for (let index = 0; index < count; index += 1) {
    const zero = buffer.indexOf(0, offset);
    if (zero < 0 || zero >= end)
      throw new Error("AVM1: строка пула не закрыта нулём.");
    strings.push(buffer.toString("utf8", offset, zero));
    offset = zero + 1;
  }
  if (offset !== end) throw new Error("AVM1: в пуле строк лишние байты.");
  return strings;
}

/* Двойная точность в SWF хранится двумя словами little-endian, но старшее
   слово идёт первым — так записывал ещё Flash 5, так читает и Scaleform. */
function readSwfDouble(buffer, offset) {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32LE(buffer.readUInt32LE(offset + 4), 0);
  bytes.writeUInt32LE(buffer.readUInt32LE(offset), 4);
  return bytes.readDoubleLE(0);
}

function writeSwfDouble(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(value, 0);
  const swapped = Buffer.alloc(8);
  swapped.writeUInt32LE(bytes.readUInt32LE(4), 0);
  swapped.writeUInt32LE(bytes.readUInt32LE(0), 4);
  return swapped;
}

/**
 * Значения одного Push. Строки из пула разворачиваются в сами строки, поэтому
 * `["colourHealth"]` совпадает и с литералом, и с индексом пула — сравнивать
 * можно по смыслу, не зная, каким способом компилятор Rockstar записал строку.
 */
export function readPush(buffer, record, pool = []) {
  if (record.code !== AVM1.PUSH) throw new TypeError("AVM1: это не Push.");
  const values = [];
  const end = record.bodyStart + record.bodyLength;
  let offset = record.bodyStart;
  const constant = (index) => {
    if (index >= pool.length)
      throw new Error(`AVM1: Push ссылается на строку пула ${index} вне пула.`);
    return pool[index];
  };
  while (offset < end) {
    const type = buffer[offset];
    offset += 1;
    switch (type) {
      case PUSH_TYPE.STRING: {
        const zero = buffer.indexOf(0, offset);
        if (zero < 0 || zero >= end)
          throw new Error("AVM1: строка в Push не закрыта нулём.");
        values.push(buffer.toString("utf8", offset, zero));
        offset = zero + 1;
        break;
      }
      case PUSH_TYPE.FLOAT:
        values.push(buffer.readFloatLE(offset));
        offset += 4;
        break;
      case PUSH_TYPE.NULL:
        values.push(null);
        break;
      case PUSH_TYPE.UNDEFINED:
        values.push(undefined);
        break;
      case PUSH_TYPE.REGISTER:
        values.push(register(buffer[offset]));
        offset += 1;
        break;
      case PUSH_TYPE.BOOLEAN:
        values.push(buffer[offset] !== 0);
        offset += 1;
        break;
      case PUSH_TYPE.DOUBLE:
        values.push(readSwfDouble(buffer, offset));
        offset += 8;
        break;
      case PUSH_TYPE.INTEGER:
        values.push(buffer.readInt32LE(offset));
        offset += 4;
        break;
      case PUSH_TYPE.CONSTANT8:
        values.push(constant(buffer[offset]));
        offset += 1;
        break;
      case PUSH_TYPE.CONSTANT16:
        values.push(constant(buffer.readUInt16LE(offset)));
        offset += 2;
        break;
      default:
        throw new Error(`AVM1: неизвестный тип значения Push ${type}.`);
    }
  }
  if (offset !== end) throw new Error("AVM1: Push длиннее своих значений.");
  return values;
}

export function action(code, body = Buffer.alloc(0)) {
  if (code < 0x80) {
    if (body.length) throw new Error(`AVM1: у действия ${hex(code)} нет тела.`);
    return Buffer.from([code]);
  }
  if (body.length > 0xffff)
    throw new RangeError(`AVM1: тело действия ${hex(code)} больше 65535 байт.`);
  const header = Buffer.alloc(3);
  header[0] = code;
  header.writeUInt16LE(body.length, 1);
  return Buffer.concat([header, body]);
}

/**
 * Push из значений. Строка, которая уже есть в пуле, пишется индексом — так
 * пишет и компилятор Rockstar; новая — литералом, пул при этом не трогается.
 * Целые пишутся 32-битными, остальные числа — двойной точностью.
 */
export function pushAction(values, pool = []) {
  const chunks = [];
  for (const value of values) {
    if (typeof value === "string") {
      const index = pool.indexOf(value);
      if (index >= 0 && index < 256) chunks.push(Buffer.from([8, index]));
      else if (index >= 0) {
        const bytes = Buffer.alloc(3);
        bytes[0] = PUSH_TYPE.CONSTANT16;
        bytes.writeUInt16LE(index, 1);
        chunks.push(bytes);
      } else
        chunks.push(
          Buffer.concat([
            Buffer.from([PUSH_TYPE.STRING]),
            Buffer.from(`${value}\0`, "utf8"),
          ]),
        );
    } else if (typeof value === "number") {
      if (Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31) {
        const bytes = Buffer.alloc(5);
        bytes[0] = PUSH_TYPE.INTEGER;
        bytes.writeInt32LE(value, 1);
        chunks.push(bytes);
      } else
        chunks.push(
          Buffer.concat([
            Buffer.from([PUSH_TYPE.DOUBLE]),
            writeSwfDouble(value),
          ]),
        );
    } else if (typeof value === "boolean") {
      chunks.push(Buffer.from([PUSH_TYPE.BOOLEAN, value ? 1 : 0]));
    } else if (value === null) {
      chunks.push(Buffer.from([PUSH_TYPE.NULL]));
    } else if (value === undefined) {
      chunks.push(Buffer.from([PUSH_TYPE.UNDEFINED]));
    } else if (Number.isInteger(value?.register)) {
      chunks.push(Buffer.from([PUSH_TYPE.REGISTER, value.register]));
    } else {
      throw new TypeError("AVM1: значение Push не поддерживается.");
    }
  }
  return action(AVM1.PUSH, Buffer.concat(chunks));
}

/**
 * Код с переходами внутри себя: шаги — готовые действия (Buffer), метки
 * `{ label }` и переходы `{ branch: AVM1.IF | AVM1.JUMP, to }`.
 *
 * Правка вида `if (…) { … } else { … }` пишется метками, как в исходнике, а
 * смещения считаются здесь: сложенные вручную байты перехода расходятся с
 * кодом при первой же поправке соседней строки. Переход наружу собранного
 * куска так не записать — метка обязана стоять внутри.
 */
export function assembleActions(steps) {
  const labels = new Map();
  let size = 0;
  for (const step of steps) {
    if (Buffer.isBuffer(step)) size += step.length;
    else if (typeof step?.label === "string") {
      if (labels.has(step.label))
        throw new Error(`AVM1: метка ${step.label} объявлена дважды.`);
      labels.set(step.label, size);
    } else if (step?.branch === AVM1.IF || step?.branch === AVM1.JUMP)
      size += 5;
    else throw new TypeError("AVM1: неизвестный шаг сборки.");
  }
  const chunks = [];
  let position = 0;
  for (const step of steps) {
    if (Buffer.isBuffer(step)) {
      chunks.push(step);
      position += step.length;
    } else if (step.branch !== undefined) {
      if (!labels.has(step.to))
        throw new Error(`AVM1: метка ${step.to} не объявлена.`);
      const offset = labels.get(step.to) - (position + 5);
      if (offset < -32768 || offset > 32767)
        throw new RangeError("AVM1: переход не помещается в 16 бит.");
      const body = Buffer.alloc(2);
      body.writeInt16LE(offset);
      chunks.push(action(step.branch, body));
      position += 5;
    }
  }
  return Buffer.concat(chunks);
}

/**
 * Блоки, размер которых записан в байтах: тела функций, `With`, три части
 * `Try`. Каждый — поле размера (где лежит) и промежуток кода (что покрывает).
 */
function blockSpans(buffer, record) {
  const spans = [];
  if (
    record.code === AVM1.DEFINE_FUNCTION ||
    record.code === AVM1.DEFINE_FUNCTION2
  ) {
    const field = record.end - 2;
    const size = buffer.readUInt16LE(field);
    spans.push({ field, start: record.end, end: record.end + size });
  } else if (record.code === AVM1.WITH) {
    const size = buffer.readUInt16LE(record.bodyStart);
    spans.push({
      field: record.bodyStart,
      start: record.end,
      end: record.end + size,
    });
  } else if (record.code === AVM1.TRY) {
    let cursor = record.end;
    for (const field of [
      record.bodyStart + 1,
      record.bodyStart + 3,
      record.bodyStart + 5,
    ]) {
      const size = buffer.readUInt16LE(field);
      spans.push({ field, start: cursor, end: cursor + size });
      cursor += size;
    }
  }
  return spans;
}

const branchTarget = (buffer, record) =>
  record.end + buffer.readInt16LE(record.bodyStart);

/**
 * Поток, в котором каждый переход и каждый блок кончаются на границе
 * действия внутри потока. Так проверяют код до правки и после неё: ошибка
 * смещения на байт превращает остаток функции в мусор, а игра узнала бы об
 * этом только при загрузке файла — молча, без сообщения.
 */
export function assertActionStream(buffer, start = 0, end = buffer.length) {
  const records = parseActions(buffer, start, end);
  const boundaries = new Set(records.map((record) => record.offset));
  boundaries.add(end);
  for (const record of records) {
    if (
      (record.code === AVM1.IF || record.code === AVM1.JUMP) &&
      !boundaries.has(branchTarget(buffer, record))
    )
      throw new Error(
        `AVM1: переход на ${record.offset} ведёт не на начало действия.`,
      );
    for (const span of blockSpans(buffer, record))
      if (!boundaries.has(span.end))
        throw new Error(
          `AVM1: блок на ${record.offset} кончается не на границе действия.`,
        );
  }
  return records;
}

/**
 * Переписывает кусок потока действий.
 *
 * `edits` — `{ start, end, replacement }` по границам действий, без
 * пересечений. Возвращает новый поток `[start, end)`: переходы и размеры
 * блоков вокруг правок пересчитаны, всё остальное перенесено байт в байт.
 *
 * `internalBranches` разрешает в замене `If` и `Jump`, которые не выходят за
 * её пределы (так собирает `assembleActions`): такой кусок переносится
 * целиком, и его смещения остаются верными без пересчёта. Переход наружу и
 * блоки — функции, `With`, `Try` — отказ и с этим флагом: их размеры и цели
 * живут вне замены. Без флага правило прежнее — никаких переходов в замене.
 *
 * `internalFunctions` разрешает ещё и новые функции, целиком лежащие в замене
 * (значение присваивания: `this.x = function…`): их размер посчитан при сборке
 * и остаётся верным.
 */
export function rewriteActions(
  buffer,
  start,
  end,
  edits,
  { internalBranches = false, internalFunctions = false } = {},
) {
  const records = parseActions(buffer, start, end);
  const boundaries = new Set(records.map((record) => record.offset));
  boundaries.add(end);
  const sorted = [...edits].sort((left, right) => left.start - right.start);
  let cursor = start;
  for (const edit of sorted) {
    if (!(edit.end > edit.start))
      throw new Error("AVM1: пустая правка не поддерживается.");
    if (!boundaries.has(edit.start) || !boundaries.has(edit.end))
      throw new Error("AVM1: правка не совпадает с границами действий.");
    if (edit.start < cursor) throw new Error("AVM1: правки пересекаются.");
    cursor = edit.end;
    const replaced = parseActions(edit.replacement, 0, edit.replacement.length);
    const inner = new Set(replaced.map((record) => record.offset));
    inner.add(edit.replacement.length);
    for (const record of replaced) {
      if (
        internalBranches &&
        (record.code === AVM1.IF || record.code === AVM1.JUMP)
      ) {
        if (!inner.has(branchTarget(edit.replacement, record)))
          throw new Error(
            "AVM1: переход в заменяющем коде ведёт за его пределы.",
          );
        continue;
      }
      if (internalFunctions && record.code === AVM1.DEFINE_FUNCTION2) {
        for (const span of blockSpans(edit.replacement, record))
          if (!inner.has(span.end))
            throw new Error(
              "AVM1: функция в заменяющем коде кончается за его пределами.",
            );
        continue;
      }
      if (
        [
          AVM1.IF,
          AVM1.JUMP,
          AVM1.DEFINE_FUNCTION,
          AVM1.DEFINE_FUNCTION2,
          AVM1.WITH,
          AVM1.TRY,
          AVM1.WAIT_FOR_FRAME,
          AVM1.WAIT_FOR_FRAME2,
        ].includes(record.code)
      )
        throw new Error(
          "AVM1: заменяющий код не может содержать переходы и блоки.",
        );
    }
  }

  const inside = (position) =>
    sorted.some((edit) => position > edit.start && position < edit.end);
  const covered = (record) =>
    sorted.some(
      (edit) => record.offset >= edit.start && record.offset < edit.end,
    );
  const moved = (position) => {
    if (inside(position))
      throw new Error(
        "AVM1: переход или блок указывает в середину заменяемого кода.",
      );
    let delta = 0;
    for (const edit of sorted)
      if (edit.end <= position)
        delta += edit.replacement.length - (edit.end - edit.start);
    return position + delta;
  };

  const fixes = [];
  for (const record of records) {
    if (covered(record)) continue;
    if (record.code === AVM1.IF || record.code === AVM1.JUMP) {
      const target = branchTarget(buffer, record);
      if (target < start || target > end)
        throw new Error("AVM1: переход ведёт за пределы потока.");
      const offset = moved(target) - moved(record.end);
      if (offset < -32768 || offset > 32767)
        throw new RangeError("AVM1: переход после правки не помещается.");
      fixes.push({
        at: record.bodyStart,
        write: (out, at) => out.writeInt16LE(offset, at),
      });
    }
    if (
      (record.code === AVM1.WAIT_FOR_FRAME ||
        record.code === AVM1.WAIT_FOR_FRAME2) &&
      sorted.length
    ) {
      const skip =
        record.code === AVM1.WAIT_FOR_FRAME
          ? buffer[record.bodyStart + 2]
          : buffer[record.bodyStart];
      const skipped = records.slice(record.index + 1, record.index + 1 + skip);
      if (skipped.some(covered))
        throw new Error("AVM1: WaitForFrame пропускает заменяемый код.");
    }
    for (const span of blockSpans(buffer, record)) {
      if (span.end > end)
        throw new Error("AVM1: блок выходит за пределы потока.");
      const size = moved(span.end) - moved(span.start);
      if (size > 0xffff)
        throw new RangeError("AVM1: блок после правки больше 65535 байт.");
      fixes.push({
        at: span.field,
        write: (out, at) => out.writeUInt16LE(size, at),
      });
    }
  }

  const chunks = [];
  let position = start;
  for (const edit of sorted) {
    chunks.push(buffer.subarray(position, edit.start), edit.replacement);
    position = edit.end;
  }
  chunks.push(buffer.subarray(position, end));
  const output = Buffer.concat(chunks);
  for (const fix of fixes) fix.write(output, moved(fix.at) - start);
  return output;
}

/**
 * Поток действий с разобранным пулом: ровно то, что нужно, чтобы искать код
 * по смыслу. Пул в потоке обязан быть один — у классов Rockstar он один на
 * `DoInitAction`; второй пул менял бы смысл индексов посреди кода, и такой
 * файл честнее не трогать.
 */
export function readProgram(buffer, start, end) {
  const records = parseActions(buffer, start, end);
  const pools = records.filter((record) => record.code === AVM1.CONSTANT_POOL);
  if (pools.length > 1)
    throw new Error("AVM1: в потоке больше одного пула строк.");
  const pool = pools.length ? readConstantPool(buffer, pools[0]) : [];
  const values = new Map();
  const pushValues = (record) => {
    if (!values.has(record.index))
      values.set(record.index, readPush(buffer, record, pool));
    return values.get(record.index);
  };
  return { buffer, start, end, records, pool, pushValues };
}

const sameValue = (left, right) =>
  typeof left === "object" && left !== null
    ? typeof right === "object" &&
      right !== null &&
      left.register === right.register
    : Object.is(left, right) || (left === 0 && right === 0);

/**
 * Совпадает ли кусок кода с образцом. Образец — список шагов: код действия
 * или `[AVM1.PUSH, значения]`; значение `ANY` совпадает с чем угодно.
 */
export const ANY = Symbol("any");

export function matchesPattern(program, index, pattern) {
  if (index + pattern.length > program.records.length) return false;
  return pattern.every((step, offset) => {
    const record = program.records[index + offset];
    const [code, expected] = Array.isArray(step) ? step : [step];
    if (record.code !== code) return false;
    if (!expected) return true;
    const values = program.pushValues(record);
    return (
      values.length === expected.length &&
      expected.every(
        (value, position) =>
          value === ANY || sameValue(values[position], value),
      )
    );
  });
}

/** Все места, где образец совпал, — индексы первых действий. */
export function findPattern(program, pattern, { from = 0, to } = {}) {
  const found = [];
  const last = to ?? program.end;
  for (const record of program.records) {
    if (record.offset < from || record.offset >= last) continue;
    if (matchesPattern(program, record.index, pattern))
      found.push(record.index);
  }
  return found;
}

/**
 * Тело метода класса: `Push …, "ИМЯ"` и сразу за ним безымянный
 * `DefineFunction2` — так компилятор Rockstar записывает `prototype.ИМЯ =
 * function () {…}`.
 */
export function findMethod(program, name) {
  const found = [];
  for (const record of program.records) {
    if (record.code !== AVM1.PUSH) continue;
    if (program.pushValues(record).at(-1) !== name) continue;
    const next = program.records[record.index + 1];
    if (
      !next ||
      (next.code !== AVM1.DEFINE_FUNCTION2 &&
        next.code !== AVM1.DEFINE_FUNCTION)
    )
      continue;
    const span = blockSpans(program.buffer, next)[0];
    found.push({ name, start: span.start, end: span.end });
  }
  if (found.length !== 1)
    throw new Error(
      `AVM1: метод ${name} найден ${found.length} раз, ожидался один.`,
    );
  return found[0];
}
