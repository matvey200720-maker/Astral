/*
 * PSO — двоичные метаданные игры (`.ymt` в `x64/data/metadata`).
 *
 * Здесь ровно столько, сколько нужно, чтобы поправить число на месте:
 * прочитать схему (PSCH) — какие у структуры поля и где они лежат, карту
 * блоков (PMAP) — где в данных (PSIN) лежат массивы структур, и пересчитать
 * контрольную сумму (CHKS) после правки. Длина файла не меняется: новые
 * элементы, строки и массивы здесь не пишутся — только значения полей.
 *
 * Все числа PSO — big-endian. Раскладка — по CodeWalker
 * (`native/CodeWalker.Core/GameFiles/MetaTypes/Pso.cs`).
 */

const SECTION = Object.freeze({
  PSIN: 0x5053494e,
  PMAP: 0x504d4150,
  PSCH: 0x50534348,
  CHKS: 0x43484b53,
});

/** Типы полей PSO (`PsoDataType`), которые умеет писать эта правка. */
export const PSO_TYPE = Object.freeze({
  bool: 0x00,
  sbyte: 0x01,
  ubyte: 0x02,
  sshort: 0x03,
  ushort: 0x04,
  sint: 0x05,
  uint: 0x06,
  float: 0x07,
  string: 0x0b,
  /* Вложенная структура: тип — по ключу ссылки поля (`ref`). */
  structure: 0x0c,
});

/*
 * Имена в схеме PSO — литеральный joaat (`atLiteralStringHash`): регистр
 * значим, `camShake` и `camshake` — разные поля. Имена файлов игра хэширует
 * строчными — это `joaat`.
 */
export function literalHash(text) {
  return jenkins(String(text));
}

/** joaat — хэш имён файлов и моделей игры (строчными). */
export function joaat(text) {
  return jenkins(String(text).toLowerCase());
}

function jenkins(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  return hash >>> 0;
}

function sections(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = new Map();
  let at = 0;
  while (at + 8 <= bytes.length) {
    const ident = view.getUint32(at);
    const length = view.getUint32(at + 4);
    if (length < 8 || at + length > bytes.length)
      throw new Error("PSO: раздел выходит за конец файла.");
    found.set(ident, { at, length });
    at += length;
  }
  if (at !== bytes.length) throw new Error("PSO: хвост файла не разобран.");
  return { view, found };
}

/**
 * Разбор PSO: `{ structures: Map<hash, { length, fields: Map<hash, {type, offset}> }>,
 * blocks: [{ name, offset, length }], dataAt }`. `offset` блока — от начала
 * раздела PSIN.
 */
export function readPso(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { view, found } = sections(bytes);
  const data = found.get(SECTION.PSIN);
  const map = found.get(SECTION.PMAP);
  const schema = found.get(SECTION.PSCH);
  if (!data || !map || !schema) throw new Error("Это не PSO: нет PSIN, PMAP или PSCH.");

  const structures = new Map();
  const count = view.getUint32(schema.at + 8);
  for (let index = 0; index < count; index += 1) {
    const indexAt = schema.at + 12 + index * 8;
    const name = view.getUint32(indexAt);
    const infoAt = schema.at + view.getUint32(indexAt + 4);
    const head = view.getUint32(infoAt);
    if (head >>> 24 !== 0) continue; // перечисление, не структура
    const entries = head & 0xffff;
    const length = view.getUint32(infoAt + 4);
    const fields = new Map();
    for (let entry = 0; entry < entries; entry += 1) {
      const at = infoAt + 12 + entry * 12;
      fields.set(view.getUint32(at), {
        type: view.getUint8(at + 4),
        offset: view.getUint16(at + 6),
        /* Ключ ссылки: у поля-структуры — имя её типа. */
        ref: view.getUint32(at + 8),
      });
    }
    structures.set(name, { length, fields });
  }

  let entries = view.getInt16(map.at + 12);
  let entriesAt = map.at + 16;
  if (entries <= 0) {
    entries = view.getInt16(map.at + 16);
    entriesAt = map.at + 24;
  }
  const blocks = [];
  for (let index = 0; index < entries; index += 1) {
    const at = entriesAt + index * 16;
    blocks.push({
      name: view.getUint32(at),
      offset: view.getUint32(at + 4),
      length: view.getUint32(at + 12),
    });
  }
  return { bytes, view, structures, blocks, dataAt: data.at, dataLength: data.length, found };
}

/**
 * Контрольная сумма PSO: joaat-подобный проход по всему файлу, в котором
 * у раздела CHKS размер файла и сама сумма — нули (так её считает игра).
 */
export function psoChecksum(bytes) {
  const { view, found } = sections(bytes);
  const chks = found.get(SECTION.CHKS);
  const copy = new Uint8Array(bytes);
  if (chks) {
    const copyView = new DataView(copy.buffer);
    copyView.setUint32(chks.at + 8, 0);
    copyView.setUint32(chks.at + 12, 0);
  }
  void view;
  let hash = 0x3fac7125;
  for (let index = 0; index < copy.length; index += 1) {
    const signed = copy[index] > 127 ? copy[index] - 256 : copy[index];
    hash = (hash + signed) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  return hash >>> 0;
}

/** Сумма из раздела CHKS или `null`, если раздела нет. */
export function storedPsoChecksum(bytes) {
  const { view, found } = sections(bytes);
  const chks = found.get(SECTION.CHKS);
  if (!chks || chks.length !== 20) return null;
  return { fileSize: view.getUint32(chks.at + 8), checksum: view.getUint32(chks.at + 12) };
}

function writeField(view, at, type, value) {
  switch (type) {
    case PSO_TYPE.float:
      view.setFloat32(at, value);
      return;
    case PSO_TYPE.bool:
    case PSO_TYPE.ubyte:
    case PSO_TYPE.sbyte:
      view.setUint8(at, value & 0xff);
      return;
    case PSO_TYPE.sshort:
    case PSO_TYPE.ushort:
      view.setUint16(at, value & 0xffff);
      return;
    case PSO_TYPE.sint:
    case PSO_TYPE.uint:
    case PSO_TYPE.string: // хэш имени (atHashString)
      view.setUint32(at, value >>> 0);
      return;
    default:
      throw new Error(`PSO: поле типа 0x${type.toString(16)} этой правкой не пишется.`);
  }
}

function readField(view, at, type) {
  switch (type) {
    case PSO_TYPE.float:
      return view.getFloat32(at);
    case PSO_TYPE.bool:
    case PSO_TYPE.ubyte:
      return view.getUint8(at);
    case PSO_TYPE.sbyte:
      return view.getInt8(at);
    case PSO_TYPE.sshort:
      return view.getInt16(at);
    case PSO_TYPE.ushort:
      return view.getUint16(at);
    case PSO_TYPE.sint:
      return view.getInt32(at);
    case PSO_TYPE.uint:
    case PSO_TYPE.string:
      return view.getUint32(at);
    default:
      return null;
  }
}

/**
 * Значения полей у всех экземпляров структуры `structure` (имя или хэш).
 * `fields` — имена полей. Для проверок и описи «было → стало».
 */
export function readPsoFields(input, structure, fields) {
  const pso = readPso(input);
  const hash = typeof structure === "number" ? structure : literalHash(structure);
  const info = pso.structures.get(hash);
  if (!info) return [];
  const view = new DataView(pso.bytes.buffer, pso.bytes.byteOffset, pso.bytes.byteLength);
  const rows = [];
  for (const block of pso.blocks.filter((item) => item.name === hash)) {
    for (let at = 0; at + info.length <= block.length; at += info.length) {
      const row = {};
      for (const name of fields) {
        const field = info.fields.get(typeof name === "number" ? name : literalHash(name));
        row[name] = field ? readField(view, pso.dataAt + block.offset + at + field.offset, field.type) : undefined;
      }
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Новые значения полей у всех экземпляров структуры: `{ поле: значение }`.
 * Возвращает `{ bytes, instances }` — копию файла с пересчитанной суммой и
 * число правленых экземпляров. Поля, которых у структуры нет, — отказ:
 * значит, у игрока другая сборка, и молча «ничего не править» нельзя.
 */
export function patchPsoFields(input, structure, values) {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const pso = readPso(source);
  const hash = typeof structure === "number" ? structure : literalHash(structure);
  const info = pso.structures.get(hash);
  if (!info) throw new Error("PSO: в файле нет нужной структуры.");
  const targets = Object.entries(values).map(([name, value]) => {
    const field = info.fields.get(literalHash(name));
    if (!field) throw new Error(`PSO: у структуры нет поля ${name}.`);
    return { field, value };
  });
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer);
  let instances = 0;
  for (const block of pso.blocks.filter((item) => item.name === hash)) {
    if (block.offset + block.length > pso.dataLength)
      throw new Error("PSO: блок данных выходит за раздел PSIN.");
    for (let at = 0; at + info.length <= block.length; at += info.length) {
      for (const { field, value } of targets)
        writeField(view, pso.dataAt + block.offset + at + field.offset, field.type, value);
      instances += 1;
    }
  }
  const chks = pso.found.get(SECTION.CHKS);
  if (chks && chks.length === 20) {
    view.setUint32(chks.at + 8, 0);
    view.setUint32(chks.at + 12, 0);
    const sum = psoChecksum(bytes);
    view.setUint32(chks.at + 8, bytes.length);
    view.setUint32(chks.at + 12, sum);
  }
  return { bytes, instances };
}

/**
 * Хеши имён (поля типа `string` — atHashString) у каждого экземпляра
 * структуры `structure`: `remap(хеш, имяПоля)` отдаёт новый хеш или
 * `undefined`/тот же — «не трогать». Нужна там, где значение надо менять по
 * тому, что в нём стоит, а не одним числом на всех: имена эффектов в классах
 * машин (`vfxvehicleinfo.ymt`). Ответ: `{ bytes, instances, matched, changed }`
 * — копия файла с пересчитанной суммой, сколько экземпляров просмотрено,
 * сколько полей remap узнал и сколько из них изменено. Структуры или поля,
 * которых нет, — отказ: у игрока другая сборка.
 */
export function remapPsoHashes(input, structure, fields, remap) {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const pso = readPso(source);
  const hash = typeof structure === "number" ? structure : literalHash(structure);
  const info = pso.structures.get(hash);
  if (!info) throw new Error("PSO: в файле нет нужной структуры.");
  const targets = fields.map((name) => {
    const field = info.fields.get(literalHash(name));
    if (!field) throw new Error(`PSO: у структуры нет поля ${name}.`);
    if (field.type !== PSO_TYPE.string) throw new Error(`PSO: поле ${name} — не имя-хеш.`);
    return { name, field };
  });
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer);
  let instances = 0;
  let matched = 0;
  let changed = 0;
  for (const block of pso.blocks.filter((item) => item.name === hash)) {
    if (block.offset + block.length > pso.dataLength)
      throw new Error("PSO: блок данных выходит за раздел PSIN.");
    for (let at = 0; at + info.length <= block.length; at += info.length) {
      instances += 1;
      for (const { name, field } of targets) {
        const place = pso.dataAt + block.offset + at + field.offset;
        const current = view.getUint32(place);
        const next = remap(current, name);
        if (next === undefined || next === null) continue;
        matched += 1;
        if ((next >>> 0) !== current) {
          view.setUint32(place, next >>> 0);
          changed += 1;
        }
      }
    }
  }
  const chks = pso.found.get(SECTION.CHKS);
  if (changed && chks && chks.length === 20) {
    view.setUint32(chks.at + 8, 0);
    view.setUint32(chks.at + 12, 0);
    const sum = psoChecksum(bytes);
    view.setUint32(chks.at + 8, bytes.length);
    view.setUint32(chks.at + 12, sum);
  }
  return { bytes, instances, matched, changed };
}

/**
 * Где в файле лежат значения поля `name`: у всех экземпляров всех структур,
 * где оно есть, в том числе внутри вложенных структур (поле типа
 * `structure`). `[{ at, type }]` — смещение от начала файла.
 *
 * Нужно там, где поле живёт не в своём блоке данных: `bAlwaysDrawBitmap`
 * мини-карты лежит в разделе `Bitmap` корневой структуры `minimap.ymt`,
 * `fBitmapRequiredZoom` — в её разделе `Camera`.
 */
export function locatePsoField(input, name) {
  const pso = readPso(input);
  const target = literalHash(name);
  const found = [];
  const visit = (structure, base, depth) => {
    const info = pso.structures.get(structure);
    if (!info || depth > 6) return;
    for (const [hash, field] of info.fields) {
      if (hash === target) found.push({ at: base + field.offset, type: field.type });
      else if (field.type === PSO_TYPE.structure && pso.structures.has(field.ref))
        visit(field.ref, base + field.offset, depth + 1);
    }
  };
  for (const block of pso.blocks) {
    const info = pso.structures.get(block.name);
    if (!info || block.offset + block.length > pso.dataLength) continue;
    for (let at = 0; at + info.length <= block.length; at += info.length)
      visit(block.name, pso.dataAt + block.offset + at, 0);
  }
  return found;
}

/** Значения поля `name` во всём файле (см. `locatePsoField`). */
export function readPsoField(input, name) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return locatePsoField(bytes, name).map(({ at, type }) => readField(view, at, type));
}

/**
 * Новые значения полей `{ имя: значение }` везде, где они есть, включая
 * вложенные структуры. `{ bytes, instances }` — копия файла с пересчитанной
 * суммой и число правленых мест. Поля нет нигде — отказ: у игрока другая
 * сборка, и молча «ничего не править» нельзя.
 */
export function patchPsoField(input, values) {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const targets = Object.entries(values).map(([name, value]) => {
    const places = locatePsoField(source, name);
    if (!places.length) throw new Error(`PSO: в файле нет поля ${name}.`);
    return { places, value };
  });
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer);
  let instances = 0;
  for (const { places, value } of targets)
    for (const { at, type } of places) {
      writeField(view, at, type, value);
      instances += 1;
    }
  const { found } = sections(bytes);
  const chks = found.get(SECTION.CHKS);
  if (chks && chks.length === 20) {
    view.setUint32(chks.at + 8, 0);
    view.setUint32(chks.at + 12, 0);
    const sum = psoChecksum(bytes);
    view.setUint32(chks.at + 8, bytes.length);
    view.setUint32(chks.at + 12, sum);
  }
  return { bytes, instances };
}
