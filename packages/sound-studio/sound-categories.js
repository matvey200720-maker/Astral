/*
 * Категории звука игры (`categories.dat22.rel`) — сколько громкости звуку
 * добавляет его категория.
 *
 * ЗАЧЕМ. Громкость, с которой игра играет лист, — это громкость узлов от
 * корня дерева до листа плюс громкость его категории и всех категорий над
 * ней. Категория — не подпись: «шлепок» удара по голове (0xF663AC66) сам
 * +9 дБ, а его категория 0x3B8F078A со своими родителями звучит на 8 дБ
 * громче категории удара; слой плоти тела сам −6 дБ, а его категория
 * 0xA6DA13DC на 6 дБ громче. Слой человека, собранный по одним громкостям
 * узлов, выходил тише удара игры на 8 дБ у головы и на 6,5 у тела
 * (27.09.2026: владелец не слышал ни того, ни другого).
 *
 * КАК УСТРОЕН ФАЙЛ. Контейнер тот же, что у звуков (`rel-edit.js`, тип 22),
 * таблиц имён, ссылок и банков нет. Категория (сверено с живым файлом Legacy
 * 27.09.2026, все 233 категории, раскладка CodeWalker `Dat22Category`):
 *
 *   u32 тип (0) и смещение имени · u32 флаги · s16 ParentOverrides ·
 *   s16 громкость, сотые дБ · s16 тон · … · u8 Timer ·
 *   u8 число подкатегорий · u32 имена подкатегорий
 *
 * Родителя у категории нет в её записи — он узнаётся по подкатегориям.
 * Категории лежат только в update.rpf: ни один пакет дополнения своих не
 * несёт (сверено по всей очереди загрузки 27.09.2026).
 *
 * Модуль только для главного процесса (подпуть
 * `@modovik/sound-studio/sound-categories`).
 */

import {
  CATEGORY_PATCH_ENTRY,
  normalizeCategoryPatches,
  shiftedCategoryVolume,
} from "./category-patch.js";
import { hexHash, readRel } from "./rel-edit.js";

/** Откуда читать категории: [архив, путь, место в порядке загрузки]. */
export const SOUND_CATEGORIES_SOURCE = Object.freeze([
  "update/update.rpf",
  "x64/audio/config/categories.dat22.rel",
  0,
]);

const CATEGORY_TYPE = 0;
const PARENT_OVERRIDES_AT = 8;
const VOLUME_AT = 10;
const SUBCATEGORY_COUNT_AT = 47;
const SUBCATEGORIES_AT = 48;
/* Начало блока данных в файле: за типом и длиной данных. */
const DATA_AT = 8;
/*
 * Бит громкости в `ParentOverrides`: категория с ним не берёт громкость
 * родителей. Биты идут по полям раскладки без кривых (громкость, тон, LPF,
 * HPF, дальность, …) — сверено с живым файлом 17.10.2026: бит 11
 * (EnvironmentalLoudness) стоит ровно у категорий с ненулевой громкостью
 * окружения (гудки, сирены, поезд), бит 12 (UnderwaterWetLevel) — у
 * столкновений, у которых UnderwaterWetLevel 150.
 */
export const VOLUME_OVERRIDE = 1;

/**
 * Категории файла: своя громкость каждой, родитель, дети, флаги «не брать
 * у родителя» и место поля громкости в файле (от начала файла).
 *
 * @param {Buffer} buffer `categories.dat22.rel` целиком
 * @returns {{
 *   volume: Map<number, number>,
 *   parent: Map<number, number>,
 *   children: Map<number, number[]>,
 *   overrides: Map<number, number>,
 *   volumeAt: Map<number, number>,
 * }}
 */
export function readSoundCategories(buffer) {
  const rel = readRel(buffer);
  if (rel.type !== 22)
    throw new Error(`Это не категории звука (тип ${rel.type}).`);
  const volume = new Map();
  const parent = new Map();
  const children = new Map();
  const overrides = new Map();
  const volumeAt = new Map();
  for (const [hash, { offset, length }] of rel.objects) {
    const bytes = rel.data.subarray(offset, offset + length);
    if (bytes.length < SUBCATEGORIES_AT || bytes[0] !== CATEGORY_TYPE)
      throw new Error(`Категория звука ${hexHash(hash)} устроена иначе, чем у Legacy.`);
    const count = bytes[SUBCATEGORY_COUNT_AT];
    if (bytes.length !== SUBCATEGORIES_AT + count * 4)
      throw new Error(`Категория звука ${hexHash(hash)} устроена иначе, чем у Legacy.`);
    volume.set(hash >>> 0, bytes.readInt16LE(VOLUME_AT));
    overrides.set(hash >>> 0, bytes.readUInt16LE(PARENT_OVERRIDES_AT));
    volumeAt.set(hash >>> 0, DATA_AT + offset + VOLUME_AT);
    const subs = [];
    for (let index = 0; index < count; index += 1) {
      const sub = bytes.readUInt32LE(SUBCATEGORIES_AT + index * 4) >>> 0;
      parent.set(sub, hash >>> 0);
      subs.push(sub);
    }
    children.set(hash >>> 0, subs);
  }
  return { volume, parent, children, overrides, volumeAt };
}

/**
 * Категории, которые сдвиг громкости ветки `root` действительно двигает:
 * она сама и те, что под ней не берут громкость у родителей
 * (`VOLUME_OVERRIDE`), — им сдвиг нужен свой, иначе «выключенная» ветка
 * звучала бы ими дальше. Дети такой категории снова берут громкость у неё.
 */
export function categoryVolumeRoots(categories, root) {
  const hash = root >>> 0;
  if (!categories.volume.has(hash))
    throw new Error(`В категориях игры нет ${hexHash(hash)} — эта сборка игры устроена иначе.`);
  const roots = [hash];
  const seen = new Set([hash]);
  const walk = (node) => {
    for (const child of categories.children.get(node) || []) {
      if (seen.has(child))
        throw new Error(`Категории звука замкнуты в круг на ${hexHash(child)}.`);
      seen.add(child);
      if ((categories.overrides.get(child) || 0) & VOLUME_OVERRIDE) roots.push(child);
      walk(child);
    }
  };
  walk(hash);
  return roots;
}

/**
 * Сдвиги громкости категорий — в копию файла, поле громкости на своём месте.
 *
 * Правка проверяется дважды: до записи — каждая категория есть в файле
 * игрока; после — файл перечитывается, громкости стоят ровно задуманные, и
 * кроме полей громкости не изменилось ни байта.
 *
 * @param {Buffer} buffer `categories.dat22.rel` игры
 * @param {Array<{category: string, gain: number}>} patches сложенные правки
 *   слоёв (`composeCategoryPatches`)
 * @returns {{buffer: Buffer, changed: number, volumes: Map<number, number>}}
 */
export function applyCategoryPatches(buffer, patches) {
  const categories = readSoundCategories(buffer);
  const list = Array.isArray(patches) ? patches : [];
  if (!list.length) throw new Error("Правка категорий звука пуста.");
  const output = Buffer.from(buffer);
  const expected = new Map();
  let changed = 0;
  for (const patch of list) {
    const [{ category }] = normalizeCategoryPatches([
      /* Сумма слоёв может выйти за предел одной правки — форма
         проверяется, а сдвиг берётся как есть и упирается в тишину. */
      { category: patch?.category, gain: Number(patch?.gain) < 0 ? -1 : 1 },
    ]);
    const gain = Number(patch.gain);
    if (!Number.isInteger(gain))
      throw new Error(`Правка категории ${category}: недопустимый сдвиг громкости.`);
    const hash = Number.parseInt(category.slice(2), 16) >>> 0;
    if (!categories.volume.has(hash))
      throw new Error(
        `В категориях звука игры нет ${category} — игра другой сборки или файл уже изменён.`,
      );
    if (expected.has(hash)) throw new Error(`Категория ${category} в правке дважды.`);
    const next = shiftedCategoryVolume(categories.volume.get(hash), gain);
    expected.set(hash, next);
    if (next === categories.volume.get(hash)) continue;
    output.writeInt16LE(next, categories.volumeAt.get(hash));
    changed += 1;
  }
  /* Перечитка: файл тот же по размеру и устройству, громкости — задуманные,
     другие байты — нетронутые. */
  const check = readSoundCategories(output);
  if (output.length !== buffer.length)
    throw new Error("Правка изменила размер категорий звука — отменена.");
  const covered = new Set();
  for (const [hash, volume] of expected) {
    const at = categories.volumeAt.get(hash);
    covered.add(at);
    covered.add(at + 1);
    if (check.volume.get(hash) !== volume)
      throw new Error("Правка категорий звука не встала на своё место — отменена.");
  }
  for (let offset = 0; offset < output.length; offset += 1)
    if (output[offset] !== buffer[offset] && !covered.has(offset))
      throw new Error("Правка категорий задела байты вне громкости — отменена.");
  return { buffer: output, changed, volumes: expected };
}

export { CATEGORY_PATCH_ENTRY };

/**
 * Сколько громкости добавляет категория вместе со всеми над ней, сотые дБ.
 * Звук без категории (`null`) ничего не получает.
 */
export function categoryVolume(categories, category) {
  if (category === null || category === undefined) return 0;
  let total = 0;
  const seen = new Set();
  for (let hash = category >>> 0; hash !== undefined; hash = categories.parent.get(hash)) {
    if (seen.has(hash))
      throw new Error(`Категории звука замкнуты в круг на ${hexHash(hash)}.`);
    seen.add(hash);
    if (!categories.volume.has(hash))
      throw new Error(`В категориях игры нет ${hexHash(hash)} — эта сборка игры устроена иначе.`);
    total += categories.volume.get(hash);
  }
  return total;
}
