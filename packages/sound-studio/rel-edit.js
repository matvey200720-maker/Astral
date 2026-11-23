/*
 * Звуковые метаданные игры целиком: чтение `.rel` и сборка своего файла.
 *
 * ЗАЧЕМ ЕЩЁ ОДИН РАЗБОР. `rel-patch.js` меняет только ссылки того же размера
 * — так правится звук попадания, где нужный узел уже есть в игре. Свой звук
 * одного ствола так не сделать: дерево выстрела у ствола почти всегда общее с
 * соседями (у штурмовой винтовки, булл-папа, улучшенной и марксманской одни и
 * те же ветви и дорожки), и любая правка общего узла слышна у всех. Ствол
 * получает собственные копии ветвей, ведущих к его голосу, в своём файле
 * звукового пакета Astral (`weapon-voice-plan.js`): здесь файлы игры
 * читаются целиком, объект за объектом, а файл пакета собирается с нуля.
 *
 * КАК УСТРОЕН ФАЙЛ (сверено с живыми sounds.dat54.rel, game.dat151.rel и
 * dlc_gtao_*.rel Legacy 26.09.2026):
 *
 *   u32 тип (54, 151; 22 — категории) · u32 длина данных · данные — u32 версия, объекты подряд
 *   u32 длина таблицы имён · { u32 число имён · u32 смещения · строки \0 }
 *   u32 число объектов · { u32 хеш имени, u32 смещение в данных, u32 длина }
 *       — отсортированы по младшему байту хеша, внутри — по хешу
 *   u32 число ссылок · u32 смещения полей-ссылок от начала файла, по возрастанию
 *   u32 число полей банка · u32 смещения полей банка от начала файла, по возрастанию
 *
 * Таблица имён — банки волн, на которые ссылаются листья этого файла: поле
 * банка у листа хранит joaat имени (через `/`), и в живых файлах нет ни
 * одного поля без имени в таблице и ни одного имени без поля. Новый банк
 * поэтому обязан попасть в таблицу того же файла.
 *
 * Модуль только для главного процесса: окно им не пользуется, и в общий
 * кусок окна он не попадает (подпуть пакета `@modovik/sound-studio/rel-edit`).
 */

const HEADER_BYTES = 8;
const MAX_OBJECT_BYTES = 64 * 1024;

/** Хеш Дженкинса (joaat) — как у игры и CodeWalker: по строчным. */
export function joaat(text) {
  let hash = 0;
  const value = String(text ?? "").toLowerCase();
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

/** Хеш банка так, как его хранит поле листа: имя из таблицы, `\` → `/`. */
export const bankHash = (name) => joaat(String(name).split("\\").join("/"));

export const hexHash = (value) =>
  `0X${(Number(value) >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;

const parseHash = (value) => {
  if (typeof value === "number" && Number.isInteger(value)) return value >>> 0;
  const match = /^(?:0X)?([0-9A-F]{1,8})$/i.exec(String(value ?? "").trim());
  if (!match) throw new Error(`Недопустимый хеш звукового объекта: ${value}.`);
  return Number.parseInt(match[1], 16) >>> 0;
};

/* Порядок индекса игры: младший байт хеша, затем хеш целиком. */
const indexOrder = (left, right) =>
  (left.name & 0xff) - (right.name & 0xff) || left.name - right.name;

/**
 * Разбор всего файла.
 *
 * `index` — записи индекса в порядке файла (с повторами, если они есть);
 * `objects` — первый объект с каждым именем, как его находит игра.
 */
/* Меньше не бывает: тип, длина данных, таблица имён и три пустые таблицы —
   так выглядит пустой файл основы звукового пакета. */
const MIN_REL_BYTES = 28;

export function readRel(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_REL_BYTES)
    throw new Error("Файл метаданных звука пуст или обрезан.");
  let offset = 0;
  const u32 = () => {
    if (offset + 4 > buffer.length)
      throw new Error("Файл метаданных звука обрезан.");
    const value = buffer.readUInt32LE(offset);
    offset += 4;
    return value;
  };
  const type = u32();
  if (type !== 54 && type !== 151 && type !== 22)
    throw new Error(
      `Это не звуки, не настройки и не категории игры (тип ${type}): правка понимает только dat54, dat151 и dat22.`,
    );
  const dataLength = u32();
  if (HEADER_BYTES + dataLength > buffer.length)
    throw new Error("Блок данных метаданных звука обрезан.");
  const data = buffer.subarray(HEADER_BYTES, HEADER_BYTES + dataLength);
  offset = HEADER_BYTES + dataLength;

  const tableLength = u32();
  const tableStart = offset;
  const nameCount = u32();
  const nameOffsets = [];
  for (let index = 0; index < nameCount; index += 1) nameOffsets.push(u32());
  const stringsStart = offset;
  const names = nameOffsets.map((at) => {
    const start = stringsStart + at;
    const end = buffer.indexOf(0, start);
    if (start >= buffer.length || end < 0 || end > tableStart + tableLength)
      throw new Error("Таблица имён метаданных звука обрезана.");
    return buffer.toString("latin1", start, end);
  });
  offset = tableStart + tableLength;
  if (offset > buffer.length)
    throw new Error("Таблица имён метаданных звука выходит за файл.");

  const count = u32();
  const index = [];
  const objects = new Map();
  for (let item = 0; item < count; item += 1) {
    const name = u32();
    const at = u32();
    const length = u32();
    if (at + length > dataLength)
      throw new Error("Объект метаданных звука выходит за блок данных.");
    index.push({ name, offset: at, length });
    if (!objects.has(name)) objects.set(name, { offset: at, length });
  }
  const readTable = () => {
    const size = u32();
    const values = new Array(size);
    for (let item = 0; item < size; item += 1) {
      const at = u32();
      if (at < HEADER_BYTES || at + 4 > HEADER_BYTES + dataLength)
        throw new Error("Таблица метаданных звука указывает за блок данных.");
      values[item] = at;
    }
    return values;
  };
  const links = readTable();
  const packs = readTable();
  if (offset !== buffer.length)
    throw new Error("Размер файла метаданных звука не сходится с таблицами.");
  return { type, data, names, index, objects, links, packs };
}

/** Файл из разобранного вида: индекс и таблицы — в порядке игры. */
export function writeRel({ type, data, names, index, links, packs }) {
  const strings = names.map((name) => Buffer.from(`${name}\0`, "latin1"));
  const stringBytes = strings.reduce((sum, item) => sum + item.length, 0);
  const tableLength = 4 + names.length * 4 + stringBytes;
  const ordered = [...index].sort(indexOrder);
  const sortedLinks = [...links].sort((left, right) => left - right);
  const sortedPacks = [...packs].sort((left, right) => left - right);
  const total =
    HEADER_BYTES +
    data.length +
    4 +
    tableLength +
    4 +
    ordered.length * 12 +
    4 +
    sortedLinks.length * 4 +
    4 +
    sortedPacks.length * 4;
  const out = Buffer.alloc(total);
  let offset = 0;
  const u32 = (value) => {
    out.writeUInt32LE(value >>> 0, offset);
    offset += 4;
  };
  u32(type);
  u32(data.length);
  data.copy(out, offset);
  offset += data.length;
  u32(tableLength);
  u32(names.length);
  let at = 0;
  for (const item of strings) {
    u32(at);
    at += item.length;
  }
  for (const item of strings) {
    item.copy(out, offset);
    offset += item.length;
  }
  u32(ordered.length);
  for (const entry of ordered) {
    u32(entry.name);
    u32(entry.offset);
    u32(entry.length);
  }
  u32(sortedLinks.length);
  for (const value of sortedLinks) u32(value);
  u32(sortedPacks.length);
  for (const value of sortedPacks) u32(value);
  if (offset !== total) throw new Error("Сборка метаданных звука сбилась.");
  return out;
}

/*
 * Блок данных начинается с четырёх байт версии (CodeWalker зовёт её
 * `Version`), объекты — за ними: первое смещение в индексе у всех файлов игры
 * — 4. У базы update.rpf версия 0x040B8D4C, у пакетов дополнений — свои
 * номера сборки. Файл пакета Astral берёт версию базы.
 */
export const REL_DATA_VERSION = 0x040b8d4c;

/**
 * Файл метаданных звука с нуля — для пакета Astral: версия, объекты подряд
 * (у настроек dat151 — с выравниванием по 4 байта, как у игры), имена
 * банков, таблицы ссылок и полей банка из смещений каждого объекта.
 *
 * Ссылки здесь ведут и на объекты других файлов игры — так делают все пакеты
 * дополнений Rockstar (дерево выстрела MK2 из mpgunrunning ссылается на узлы
 * базы), и игра находит объект по имени во всех загруженных файлах. Поле
 * банка — только на банк из таблицы имён этого же файла.
 *
 * @param {{type: 54|151, objects: Array<{hash: number, bytes: Buffer,
 *   links?: number[], packs?: number[]}>, names?: string[], version?: number}} input
 */
export function buildRel({
  type,
  objects = [],
  names = [],
  version = REL_DATA_VERSION,
}) {
  if (type !== 54 && type !== 151)
    throw new Error(`Тип метаданных звука ${type} не поддерживается.`);
  const ownNames = [];
  for (const name of names) {
    const value = String(name || "");
    if (!/^[A-Za-z0-9_]+\\[A-Za-z0-9_]+$/.test(value) || value.length > 96)
      throw new Error(`Недопустимое имя банка: ${value}.`);
    if (!ownNames.includes(value)) ownNames.push(value);
  }
  const banks = new Set(ownNames.map(bankHash));
  const seen = new Set();
  const index = [];
  const links = [];
  const packs = [];
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(Number(version) >>> 0, 0);
  const chunks = [prefix];
  let length = prefix.length;
  for (const object of [...objects].sort((left, right) => left.hash - right.hash)) {
    if (type === 151 && length % 4) {
      const pad = Buffer.alloc(4 - (length % 4));
      chunks.push(pad);
      length += pad.length;
    }
    const hash = parseHash(object.hash);
    const bytes = Buffer.isBuffer(object.bytes)
      ? object.bytes
      : Buffer.from(String(object.bytes || ""), "base64");
    if (seen.has(hash))
      throw new Error(`Объект ${hexHash(hash)} встречается дважды.`);
    if (!bytes.length || bytes.length > MAX_OBJECT_BYTES)
      throw new Error(`Объект ${hexHash(hash)} пуст или слишком велик.`);
    if (bytes[0] === 0)
      throw new Error(`У объекта ${hexHash(hash)} нет типа.`);
    seen.add(hash);
    const start = HEADER_BYTES + length;
    for (const at of object.links || []) {
      if (!Number.isInteger(at) || at < 1 || at + 4 > bytes.length)
        throw new Error(`Ссылка ${at} выходит за объект ${hexHash(hash)}.`);
      links.push(start + at);
    }
    for (const at of object.packs || []) {
      if (!Number.isInteger(at) || at < 1 || at + 4 > bytes.length)
        throw new Error(`Поле банка ${at} выходит за объект ${hexHash(hash)}.`);
      if (!banks.has(bytes.readUInt32LE(at)))
        throw new Error(
          `Лист ${hexHash(hash)} ведёт в банк ${hexHash(bytes.readUInt32LE(at))}, которого нет в таблице имён.`,
        );
      packs.push(start + at);
    }
    index.push({ name: hash, offset: length, length: bytes.length });
    chunks.push(bytes);
    length += bytes.length;
  }
  const output = writeRel({
    type,
    data: Buffer.concat(chunks, length),
    names: ownNames,
    index,
    links,
    packs,
  });
  const check = readRel(output);
  if (check.objects.size !== index.length || check.names.length !== ownNames.length)
    throw new Error("Файл метаданных звука собрался не так — отменено.");
  return output;
}

/** Объекты файла в виде, пригодном для `buildRel`: для сборки поверх основы. */
export function relObjects(buffer) {
  const rel = readRelForWalk(buffer);
  return {
    type: rel.type,
    version: rel.data.length >= 4 ? rel.data.readUInt32LE(0) : REL_DATA_VERSION,
    names: rel.names,
    objects: [...rel.objects.keys()].map((hash) => {
      const object = relObject(rel, hash);
      return {
        hash,
        bytes: Buffer.from(object.bytes),
        links: object.links,
        packs: object.packs,
      };
    }),
  };
}

/* Поля таблицы внутри объекта: двоичный поиск по отсортированной таблице. */
function fieldsInside(table, start, length) {
  let low = 0;
  let high = table.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (table[middle] < start) low = middle + 1;
    else high = middle;
  }
  const inside = [];
  for (let item = low; item < table.length; item += 1) {
    if (table[item] + 4 > start + length) break;
    inside.push(table[item] - start);
  }
  return inside;
}

/**
 * Объект файла с его ссылками и полями банка — смещения от начала объекта.
 * Таблицы в разобранном файле обязаны быть отсортированы (так их пишет игра
 * и `writeRel`).
 */
export function relObject(rel, hash) {
  const place = rel.objects.get(parseHash(hash));
  if (!place) return null;
  const start = HEADER_BYTES + place.offset;
  return {
    hash: parseHash(hash),
    offset: place.offset,
    length: place.length,
    type: rel.data[place.offset],
    bytes: rel.data.subarray(place.offset, place.offset + place.length),
    links: fieldsInside(rel.sortedLinks || rel.links, start, place.length),
    packs: fieldsInside(rel.sortedPacks || rel.packs, start, place.length),
  };
}

/** Разбор с отсортированными таблицами — для обхода деревьев. */
export function readRelForWalk(buffer) {
  const rel = readRel(buffer);
  return {
    ...rel,
    sortedLinks: [...rel.links].sort((left, right) => left - right),
    sortedPacks: [...rel.packs].sort((left, right) => left - right),
  };
}
