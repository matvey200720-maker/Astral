/*
 * Правка громкости категорий звука — `categories.dat22.rel`.
 *
 * ЗАЧЕМ. Категория — ручка микшера игры: громкость звука в игре — это
 * громкость его узлов плюс громкость его категории и всех категорий над ней
 * (`sound-categories.js`). Двигатели, сирены, ветер, дождь, птицы и речь
 * прохожих лежат каждый в своей категории, и «окружение» студии звуков
 * двигает именно их: ветер тише, сирены выключены — и ничего больше.
 *
 * ЧТО ИМЕННО ПРАВИТСЯ. Только поле громкости категории (s16, сотые доли
 * децибела) на своём месте: размер файла, порядок объектов и все остальные
 * поля остаются байт в байт. Правка — не новое значение, а сдвиг от того,
 * что стоит у игры (`gain`): обновление игры, которое поменяет громкость
 * категории, не превратит «на 6 дБ тише» в чужое число. Сдвиг −100 дБ — это
 * «выключено»: громкость упирается в тишину игры.
 *
 * Правки нескольких слоёв одной категории складываются — каждая сдвигает
 * громкость на свои децибелы, и спорить им не о чем.
 *
 * Здесь только форма правки — без чтения файла: модуль входит и в окно (через
 * `rel-patch.js`). Сама запись — `applyCategoryPatches` в
 * `sound-categories.js`, только для главного процесса.
 */

/** Файл категорий в update.rpf — игра читает их только оттуда. */
export const CATEGORY_PATCH_ENTRY = "x64/audio/config/categories.dat22.rel";

/** Тишина игры: громкость −100 дБ. Ниже категория не опускается. */
export const CATEGORY_SILENCE = -10000;
/* Громче этого правка категорию не поднимает: у игры самые громкие
   категории +2000, и +24 дБ сверху — уже не звук, а перегруз. */
export const CATEGORY_LOUDEST = 4400;
/* Сдвиг одной правки: от тишины до +12 дБ. */
const GAIN_MIN = CATEGORY_SILENCE;
const GAIN_MAX = 1200;
/* У игры 233 категории; правка больше этого — не наша. */
const PATCHES_MAX = 256;

const HASH_ID = /^(?:0X)?([0-9A-F]{1,8})$/i;

const categoryId = (value) => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0)
    return `0X${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  const match = HASH_ID.exec(String(value ?? "").trim());
  return match ? `0X${match[1].toUpperCase().padStart(8, "0")}` : null;
};

/**
 * Список правок категорий в одном виде: `{ category: "0X…", gain }`, где
 * `gain` — сдвиг громкости в сотых дБ. Нулевой сдвиг правкой не считается,
 * одна категория дважды — тоже (окно или чужой файл перепутали правку).
 */
export function normalizeCategoryPatches(patches) {
  if (!Array.isArray(patches) || !patches.length)
    throw new Error("Правка категорий звука пуста.");
  if (patches.length > PATCHES_MAX)
    throw new Error("Правка категорий звука слишком велика.");
  const seen = new Set();
  return patches.map((patch) => {
    const category = categoryId(patch?.category);
    const gain = Number(patch?.gain);
    if (!category) throw new Error("Правка категорий звука без категории.");
    if (!Number.isInteger(gain) || gain === 0 || gain < GAIN_MIN || gain > GAIN_MAX)
      throw new Error(`Правка категории ${category}: недопустимый сдвиг громкости.`);
    if (seen.has(category))
      throw new Error(`Категория ${category} в правке дважды.`);
    seen.add(category);
    return { category, gain };
  });
}

/**
 * Правки всех слоёв одного файла — одним списком: сдвиги одной категории
 * складываются. Порядок — по категории, чтобы одинаковый набор слоёв давал
 * одинаковый файл.
 *
 * @param {Array<{modId: string, patches: object[]}>} layers
 */
export function composeCategoryPatches(layers) {
  const sums = new Map();
  for (const layer of Array.isArray(layers) ? layers : [])
    for (const patch of normalizeCategoryPatches(layer?.patches))
      sums.set(patch.category, (sums.get(patch.category) || 0) + patch.gain);
  return [...sums]
    .filter(([, gain]) => gain !== 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, gain]) => ({ category, gain }));
}

/** Громкость категории после сдвига — в пределах тишины и перегруза. */
export const shiftedCategoryVolume = (volume, gain) =>
  Math.max(CATEGORY_SILENCE, Math.min(CATEGORY_LOUDEST, volume + gain));
