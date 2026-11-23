/*
 * Правка звуковых метаданных игры — `*.dat54.rel` и `*.dat151.rel`.
 *
 * ЗАЧЕМ. Звук в GTA V — не файл, а дерево: настройки материала или ствола
 * (dat151) ссылаются на звуки (dat54) — мультитреки, случайные выборы,
 * обёртки, — и только листья этого дерева указывают на дорожку в AWC-банке.
 * Одна и та же дорожка висит в нескольких деревьях сразу: слой попадания в
 * голову звучит ещё и в ударе кулаком, а волна правого канала карабина — в
 * выстреле микро-ПП у NPC. Заменить «попадание в голову» одной дорожкой нельзя
 * — вместе с ним поменялось бы ещё что-нибудь. Чисто это делается в дереве:
 * нужный узел перестаёт ссылаться на общую дорожку и ссылается на свою.
 *
 * ЧТО ИМЕННО ПРАВИТСЯ. Только ссылки «ребёнок → объект», и только того же
 * размера: четыре байта хеша на месте четырёх байт хеша. Размер файла, место
 * каждого объекта и таблицы файла остаются нетронутыми, поэтому правку нельзя
 * «собрать криво» — она либо встаёт ровно на своё место, либо отвергается.
 *
 * КАК УСТРОЕН ФАЙЛ (снято с живых файлов Legacy и сверено с CodeWalker):
 *
 *   u32 тип (54, 151, …) · u32 длина блока данных · блок данных
 *   u32 длина таблицы имён · u32 число имён · смещения · имена (нуль-строки)
 *   u32 число объектов · { u32 хеш имени, u32 смещение в блоке, u32 длина }
 *   u32 число хешей · смещения полей-хешей ОТ НАЧАЛА ФАЙЛА
 *   u32 число упаковок · смещения полей-контейнеров от начала файла
 *
 * Таблица хешей — список полей, которые игра при загрузке превращает из хеша
 * в ссылку на объект. Правка трогает только такие поля: смещение обязано
 * лежать в этой таблице и внутри своего объекта. Всё остальное (громкость,
 * веса, контейнеры волн) правкой не считается и отвергается.
 *
 * `audioconfig.dat4.rel` устроен иначе (индекс строками) и здесь не
 * читается: он нужен только для размеров слотов, а их студия держит
 * таблицей (см. `wave-slots.js`).
 */

import {
  CATEGORY_PATCH_ENTRY,
  normalizeCategoryPatches,
} from "./category-patch.js";

const HEADER_BYTES = 8;
const HASH_ID = /^(?:0X)?([0-9A-F]{1,8})$/i;

/** Хеш в форме студии: `0X` и восемь цифр. */
export function relHash(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0)
    return `0X${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  const match = HASH_ID.exec(String(value ?? "").trim());
  return match ? `0X${match[1].toUpperCase().padStart(8, "0")}` : null;
}

const hashNumber = (value) => {
  const id = relHash(value);
  if (!id) throw new Error(`Недопустимый хеш объекта звука: ${value}.`);
  return Number.parseInt(id.slice(2), 16) >>> 0;
};

class RelReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  u32() {
    if (this.offset + 4 > this.buffer.length)
      throw new Error("Файл метаданных звука обрезан.");
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }
}

/**
 * Разбор .rel: где лежат объекты и какие поля — ссылки.
 *
 * @param {Buffer} buffer весь файл
 * @returns {{
 *   type: number,
 *   dataStart: number,
 *   dataLength: number,
 *   objects: Map<number, {offset: number, length: number}>,
 *   hashOffsets: Uint32Array,
 * }} смещения объектов — от начала файла; поля-ссылки — отсортированы
 */
export function parseRelFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32)
    throw new Error("Файл метаданных звука пуст или обрезан.");
  const reader = new RelReader(buffer);
  const type = reader.u32();
  if (![54, 151].includes(type))
    throw new Error(
      `Это не звуки и не настройки игры (тип ${type}): правка метаданных понимает только dat54 и dat151.`,
    );
  const dataLength = reader.u32();
  const dataStart = HEADER_BYTES;
  if (dataStart + dataLength > buffer.length)
    throw new Error("Блок данных метаданных звука обрезан.");
  reader.offset = dataStart + dataLength;

  reader.u32(); // длина таблицы имён
  const names = reader.u32();
  reader.offset += names * 4;
  for (let index = 0; index < names; index += 1) {
    const end = buffer.indexOf(0, reader.offset);
    if (end < 0) throw new Error("Таблица имён метаданных звука обрезана.");
    reader.offset = end + 1;
  }

  const count = reader.u32();
  const objects = new Map();
  for (let index = 0; index < count; index += 1) {
    const name = reader.u32();
    const offset = reader.u32();
    const length = reader.u32();
    if (offset + length > dataLength)
      throw new Error("Объект метаданных звука выходит за блок данных.");
    /* Имя встречается дважды — берётся первое: так поступает и игра, и
       правка, найденная не там, где её ждали, хуже отказа. */
    if (!objects.has(name))
      objects.set(name, { offset: dataStart + offset, length });
  }

  const hashes = reader.u32();
  const hashOffsets = new Uint32Array(hashes);
  for (let index = 0; index < hashes; index += 1) {
    const offset = reader.u32();
    if (offset + 4 > buffer.length)
      throw new Error("Таблица ссылок метаданных звука указывает за файл.");
    hashOffsets[index] = offset;
  }
  hashOffsets.sort();

  const packs = reader.u32();
  reader.offset += packs * 4;
  if (reader.offset !== buffer.length)
    throw new Error("Размер файла метаданных звука не сходится с таблицами.");

  return { type, dataStart, dataLength, objects, hashOffsets };
}

/* Поля-ссылки внутри объекта: двоичный поиск по отсортированной таблице. */
function linksInside(parsed, object) {
  const { hashOffsets } = parsed;
  let low = 0;
  let high = hashOffsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (hashOffsets[middle] < object.offset) low = middle + 1;
    else high = middle;
  }
  const inside = [];
  for (let index = low; index < hashOffsets.length; index += 1) {
    const offset = hashOffsets[index];
    if (offset + 4 > object.offset + object.length) break;
    inside.push(offset);
  }
  return inside;
}

/**
 * Нормализует список правок и отвергает всё, что правкой ссылки не является.
 *
 * Правка — `{ object, from, to, count }`: в объекте `object` ссылка на `from`
 * становится ссылкой на `to`, и таких мест ровно `count` (по умолчанию —
 * одно). Число мест записано явно нарочно: если в чужой или обновлённой игре
 * у объекта окажется другой состав, правка не «поправит что нашла», а
 * откажется.
 */
export function normalizeRelPatches(patches) {
  if (!Array.isArray(patches) || !patches.length)
    throw new Error("Правка метаданных звука пуста.");
  if (patches.length > 512)
    throw new Error("Правка метаданных звука слишком велика.");
  const seen = new Map();
  const list = [];
  for (const patch of patches) {
    const object = relHash(patch?.object);
    const from = relHash(patch?.from);
    const to = relHash(patch?.to);
    const count = patch?.count === undefined ? 1 : Number(patch.count);
    if (!object || !from || !to)
      throw new Error("Правка метаданных звука без объекта или ссылки.");
    if (from === to) throw new Error(`Правка ${object}: ссылка не меняется.`);
    if (!Number.isInteger(count) || count < 1 || count > 64)
      throw new Error(`Правка ${object}: недопустимое число мест.`);
    const key = `${object}:${from}`;
    const previous = seen.get(key);
    if (previous) {
      if (previous.to !== to || previous.count !== count)
        throw new Error(
          `Правки расходятся: ${object} ведёт ${from} и на ${previous.to}, и на ${to}.`,
        );
      continue;
    }
    const value = { object, from, to, count };
    seen.set(key, value);
    list.push(value);
  }
  return list;
}

/**
 * Где каждая правка встанет в этот файл. Ничего не пишет — только проверяет:
 * объект есть, ссылок на `from` внутри него ровно `count`, `to` — объект
 * того же файла (или объявлен внешним), и две правки не бьют в одно место.
 *
 * @returns {Array<{patch: object, offsets: number[]}>}
 */
export function locateRelPatches(buffer, patches, { external = [] } = {}) {
  const parsed = parseRelFile(buffer);
  const list = normalizeRelPatches(patches);
  const outside = new Set(external.map(relHash).filter(Boolean));
  const taken = new Map();
  const located = [];
  for (const patch of list) {
    const object = parsed.objects.get(hashNumber(patch.object));
    if (!object)
      throw new Error(
        `В метаданных звука нет объекта ${patch.object} — игра не той версии или файл уже изменён.`,
      );
    if (!parsed.objects.has(hashNumber(patch.to)) && !outside.has(patch.to))
      throw new Error(
        `Правка ${patch.object} ведёт на ${patch.to}, а такого объекта в файле нет.`,
      );
    const from = hashNumber(patch.from);
    const offsets = linksInside(parsed, object).filter(
      (offset) => buffer.readUInt32LE(offset) === from,
    );
    if (offsets.length !== patch.count)
      throw new Error(
        `В объекте ${patch.object} ссылок на ${patch.from}: ${offsets.length}, ожидалось ${patch.count}. Файл звуков игры изменён — правка не встанет.`,
      );
    for (const offset of offsets) {
      const other = taken.get(offset);
      if (other && other.to !== patch.to)
        throw new Error(
          `Две правки бьют в одну ссылку объекта ${patch.object}.`,
        );
      taken.set(offset, patch);
    }
    located.push({ patch, offsets });
  }
  return located;
}

/**
 * Применяет правки к копии файла и перечитывает результат.
 *
 * @returns {{buffer: Buffer, changed: number}} новый файл того же размера
 */
export function applyRelPatches(buffer, patches, options = {}) {
  const located = locateRelPatches(buffer, patches, options);
  const output = Buffer.from(buffer);
  let changed = 0;
  for (const { patch, offsets } of located)
    for (const offset of offsets) {
      output.writeUInt32LE(hashNumber(patch.to), offset);
      changed += 1;
    }
  /* Перечитка: таблицы и объекты на месте, каждая правка стоит где надо, и
     кроме этих мест не изменилось ни байта. */
  parseRelFile(output);
  if (output.length !== buffer.length)
    throw new Error("Правка изменила размер метаданных звука — отменена.");
  const expected = new Map();
  const covered = new Set();
  for (const { patch, offsets } of located)
    for (const offset of offsets) {
      expected.set(offset, hashNumber(patch.to));
      for (let byte = 0; byte < 4; byte += 1) covered.add(offset + byte);
    }
  for (let offset = 0; offset < output.length; offset += 1)
    if (output[offset] !== buffer[offset] && !covered.has(offset))
      throw new Error("Правка задела байты вне ссылок — отменена.");
  for (const [offset, value] of expected)
    if (output.readUInt32LE(offset) !== value)
      throw new Error("Правка не встала на своё место — отменена.");
  return { buffer: output, changed };
}

/**
 * Правки нескольких слоёв одного файла — одним списком.
 *
 * Слои ставятся независимо, но пишут в один и тот же файл игры. Две правки
 * одной ссылки в разные стороны — это два мода, которые спорят, и такой
 * спор решает человек, а не порядок установки.
 *
 * @param {Array<{modId: string, patches: object[]}>} layers
 */
export function composeRelPatches(layers) {
  const byKey = new Map();
  const list = [];
  for (const layer of Array.isArray(layers) ? layers : []) {
    for (const patch of normalizeRelPatches(layer?.patches)) {
      const key = `${patch.object}:${patch.from}`;
      const previous = byKey.get(key);
      if (previous) {
        if (previous.patch.to !== patch.to || previous.patch.count !== patch.count)
          throw new Error(
            `Звуковые моды ${previous.modId} и ${layer.modId} по-разному правят ${patch.object}.`,
          );
        continue;
      }
      byKey.set(key, { modId: String(layer?.modId || ""), patch });
      list.push(patch);
    }
  }
  return list;
}

/** Формат полезной нагрузки слоя: один JSON на один файл метаданных. */
export const REL_PATCH_FORMAT = "astral-audio-rel-patch";
export const REL_PATCH_VERSION = 1;

/*
 * Какие файлы метаданных правка трогает и где они лежат. Все — в
 * `update/update.rpf`: игра читает их оттуда, а не из `audio_rel.rpf`.
 * У звуков и настроек правятся ссылки, у категорий — громкость
 * (`category-patch.js`, «Окружение» студии звуков, 17.10.2026).
 */
export const REL_PATCH_ENTRIES = Object.freeze([
  "x64/audio/config/sounds.dat54.rel",
  "x64/audio/config/game.dat151.rel",
  CATEGORY_PATCH_ENTRY,
]);

/** Полезная нагрузка слоя правок: проверенная и в одном виде. */
export function normalizeRelPatchPayload(value) {
  const source = value && typeof value === "object" ? value : {};
  if (source.format !== REL_PATCH_FORMAT)
    throw new Error("Это не правка метаданных звука Astral.");
  if (Number(source.version) !== REL_PATCH_VERSION)
    throw new Error("Версия правки метаданных звука не поддерживается.");
  const entry = String(source.entry || "");
  if (!REL_PATCH_ENTRIES.includes(entry))
    throw new Error("Правка метаданных звука нацелена на чужой файл.");
  return {
    format: REL_PATCH_FORMAT,
    version: REL_PATCH_VERSION,
    entry,
    patches:
      entry === CATEGORY_PATCH_ENTRY
        ? normalizeCategoryPatches(source.patches)
        : normalizeRelPatches(source.patches),
  };
}
