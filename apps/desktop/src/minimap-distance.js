import path from "node:path";
import {
  MINIMAP_DISTANCE_LABELS,
  MINIMAP_DISTANCE_LANGUAGES,
  minimapDistanceActive,
  normalizeMinimapDistance,
  replaceDistanceUnit,
} from "@modovik/minimap-contract";
import { openRpfFile, keysFromDirectory } from "@modovik/rpf7/node";
import { archiveKeysDirectory } from "./loader-provisioner.js";

/*
 * Слова расстояния (задача 1 ТЗ 17.10.2026): своё слово вместо «км» и «м»
 * там, где игра пишет единицу сама — `@modovik/minimap-contract/distance`.
 *
 * Тексты игры лежат таблицами `global.gxt2` в архивах языков:
 * `update2.rpf/x64/data/lang/<язык>_rel.rpf` (у сборок без update2 —
 * `x64b.rpf/data/lang/...`), а поверх них игра кладёт таблицу-заплатку
 * `update.rpf/x64/patch/data/lang/<язык>_rel.rpf/global.gxt2`: её строки
 * перекрывают одноимённые ярлыки (так Rockstar правит тексты дополнений; у
 * японского и корейского там же лежит и заплатка `dschool.gxt2`). Установка
 * Astral пишет только в update.rpf — поэтому свои строки ложатся в
 * таблицу-заплатку: всё, что в ней было, остаётся, добавляются и
 * перекрываются только ярлыки единиц.
 *
 * Язык игры Steam хранит у себя, а не у игры, — поэтому заплатка ложится во
 * все тринадцать языков: какой бы ни был выбран, слово встанет. Исходная
 * строка ярлыка берётся из полной таблицы языка (update2/x64b), куда Astral
 * не пишет: прежняя установка своих слов не становится основой новой.
 *
 * Формат GXT2: «2TXG», число записей, пары «хэш ярлыка — смещение» по
 * возрастанию хэша, снова «2TXG» и длина файла, затем строки UTF-8 с нулём.
 * Хэш — joaat ярлыка строчными. Всё little-endian.
 */

export { MINIMAP_DISTANCE_LANGUAGES };

const MAGIC = 0x47585432; // «2TXG»
const MAX_TABLE_BYTES = 8 * 1024 * 1024;

export const distanceTarget = (language) => `update:/x64/patch/data/lang/${language}_rel.rpf/global.gxt2`;

export function gxtLabelHash(label) {
  let hash = 0;
  for (const character of String(label).toLowerCase()) {
    hash = (hash + character.charCodeAt(0)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  return hash >>> 0;
}

/** Таблица GXT2 → `Map(хэш → строка)`; не таблица — отказ словами. */
export function readGxt2Table(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (bytes.length < 16 || bytes.readUInt32LE(0) !== MAGIC)
    throw new Error("таблица текста игры не похожа на GXT2");
  const count = bytes.readUInt32LE(4);
  if (8 + count * 8 + 8 > bytes.length) throw new Error("таблица текста игры обрезана");
  const table = new Map();
  for (let index = 0; index < count; index += 1) {
    const hash = bytes.readUInt32LE(8 + index * 8);
    const offset = bytes.readUInt32LE(12 + index * 8);
    if (offset >= bytes.length) throw new Error("таблица текста игры ссылается за свой конец");
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0) end += 1;
    table.set(hash, bytes.toString("utf8", offset, end));
  }
  return table;
}

/** `Map(хэш → строка)` → таблица GXT2 (по возрастанию хэша, как у игры). */
export function writeGxt2Table(table) {
  const entries = [...table].sort((left, right) => left[0] - right[0]);
  const head = Buffer.alloc(8 + entries.length * 8 + 8);
  head.writeUInt32LE(MAGIC, 0);
  head.writeUInt32LE(entries.length, 4);
  const strings = [];
  let offset = head.length;
  entries.forEach(([hash, text], index) => {
    const bytes = Buffer.from(`${text}\0`, "utf8");
    head.writeUInt32LE(hash >>> 0, 8 + index * 8);
    head.writeUInt32LE(offset, 12 + index * 8);
    strings.push(bytes);
    offset += bytes.length;
  });
  head.writeUInt32LE(MAGIC, 8 + entries.length * 8);
  head.writeUInt32LE(offset, 12 + entries.length * 8);
  return Buffer.concat([head, ...strings]);
}

/**
 * Таблица-заплатка языка со своими словами: `{ bytes, labels }` — `labels`
 * — сколько ярлыков получили своё слово. `patch` — нынешняя заплатка
 * update.rpf (её строки сохраняются), `source` — полная таблица языка.
 */
export function distancePatchTable({ patch, source }, distance) {
  const value = normalizeMinimapDistance(distance);
  const table = patch ? readGxt2Table(patch) : new Map();
  const original = readGxt2Table(source);
  let labels = 0;
  for (const unit of ["km", "m"]) {
    const word = value[unit];
    if (!word) continue;
    for (const { label, whole } of MINIMAP_DISTANCE_LABELS[unit]) {
      const hash = gxtLabelHash(label);
      const text = original.get(hash);
      if (text === undefined) continue;
      const next = replaceDistanceUnit(text, word, { whole });
      if (next === null) continue;
      table.set(hash, next);
      labels += 1;
    }
  }
  return { bytes: writeGxt2Table(table), labels };
}

/*
 * Таблицы игры игрока: `{ [язык]: { patch, source } }` — только чтение
 * архивов. Нет update2.rpf — полные таблицы из x64b.rpf.
 */
async function readGameTables({ gameRoot, stateDir }) {
  const directory = await archiveKeysDirectory({ stateDir });
  if (!directory) throw new Error("нет набора ключей ArchiveFix — архивы игры не открыть");
  const keys = await keysFromDirectory(directory);
  const open = (file) => openRpfFile(path.join(gameRoot, file), { keys }).catch(() => null);
  const update = await open(path.join("update", "update.rpf"));
  const update2 = await open(path.join("update", "update2.rpf"));
  const base = update2 ? null : await open("x64b.rpf");
  const read = async (archive, child, entry) => {
    if (!archive) return null;
    try {
      const nested = await archive.open(child);
      const bytes = Buffer.from(await nested.read(`${child}/${entry}`));
      return bytes.length <= MAX_TABLE_BYTES ? bytes : null;
    } catch {
      return null;
    }
  };
  try {
    const tables = {};
    for (const language of MINIMAP_DISTANCE_LANGUAGES)
      tables[language] = {
        patch: await read(update, `x64/patch/data/lang/${language}_rel.rpf`, "global.gxt2"),
        source: update2
          ? await read(update2, `x64/data/lang/${language}_rel.rpf`, "global.gxt2")
          : await read(base, `data/lang/${language}_rel.rpf`, "global.gxt2"),
      };
    return tables;
  } finally {
    for (const archive of [update, update2, base]) await archive?.close?.();
  }
}

/**
 * Файлы слов расстояния для пакета мини-карты: `{ files, languages, labels }`
 * (`files` — `[{ file, target, bytes }]`, как у меток GPS) либо
 * `{ files: [], unavailable }` с причиной словами — мини-карта ставится и
 * без них. Заплатки нет у языка — язык пропускается: заменить в update.rpf
 * нечего.
 */
export async function minimapDistanceFiles({ gameRoot, stateDir, distance }, tools = {}) {
  if (!minimapDistanceActive(distance)) return { files: [], languages: 0, labels: 0 };
  let tables;
  try {
    tables = await (tools.readTables || readGameTables)({ gameRoot, stateDir });
  } catch (error) {
    return { files: [], languages: 0, labels: 0, unavailable: error?.message || String(error) };
  }
  const files = [];
  let labels = 0;
  for (const language of MINIMAP_DISTANCE_LANGUAGES) {
    const pair = tables?.[language];
    if (!pair?.patch || !pair?.source) continue;
    try {
      const table = distancePatchTable(pair, distance);
      if (!table.labels) continue;
      files.push({ file: `${language}_global.gxt2`, target: distanceTarget(language), bytes: table.bytes });
      labels = Math.max(labels, table.labels);
    } catch {
      /* Таблица языка не разобралась — язык пропускается. */
    }
  }
  return files.length
    ? { files, languages: files.length, labels }
    : { files: [], languages: 0, labels: 0, unavailable: "таблицы текста игры не прочитались" };
}
