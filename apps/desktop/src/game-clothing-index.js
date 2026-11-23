// Оглавление одежды GTA V игрока: дополнения, вещи, названия, файлы моделей и текстур.
// Собирается из архивов игры, лежит в памяти потока и в файле кэша в папке состояния.
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { openRpfFile, keysFromDirectory } from "@modovik/rpf7/node";
import { summarizeShopItems, parseShopMeta } from "@modovik/clothing/shop-meta";
import { BASE_SHOP } from "@modovik/clothing/game-assortment";
import { compareColourFiles } from "@modovik/clothing/colour-files";
import { alternatesOf, parseAlternate } from "@modovik/clothing/model-variants";
import { parseGxt2 } from "@modovik/clothing/gxt2";
import { GAME_LANGUAGE_FILES, GAME_NAME_LANGUAGES, cleanGameNames } from "@modovik/clothing/game-names";
import { dlcTitle as collectionTitle, DLC_TITLES } from "@modovik/pack-intake/dlc-packs";
import { dlcOrder } from "./game-clothing-order.js";
import { mountedArchives } from "./game-file-index.js";

export const MEMO_MS = 120000;
export const BASE_ARCHIVE = "x64v.rpf";

// Полы персонажа: [ключ в оглавлении, имя папки моделей].
const GENDERS = [
  ["male", "mp_m_freemode_01"],
  ["female", "mp_f_freemode_01"],
];

// Правила путей и имён (без учёта регистра там, где стоит i).
const PATCH_PATH = /^dlc_patch\/([^/]+)\/common\/(?:data\/)?[^/]*freemode_01[^/]*\.meta$/i;
const SHOP_PATH = /(?:^|\/)common\/(?:data\/)?[^/]*freemode_01[^/]*\.meta$/i;
const MODEL_ARCHIVE_PATH = /^x64\/models\/cdimages\/(?:peds\/)?[^/]+\.rpf$/i;
const MODEL_ARCHIVE_SKIP = /cutspeds|overlay|trevor_outfits|weapons\.rpf$/i;
const FOLDER_AND_FILE = /^(.*\/([^/]+))\/([^/]+)$/;
const GENDER_FOLDER = /^mp_[mf]_freemode_01/i;
const PROP_FOLDER = /^mp_[mf]_freemode_01_p(?:_|$)/;
const SHOP_FOLDER_HEAD = /^(mp_[mf]_freemode_01)_/;
const MODEL_FILE = /^(head|berd|hair|uppr|lowr|hand|feet|teef|accs|task|decl|jbib|p_[a-z]+)_(\d{3})(?:_[ur])?\.ydd$/;
const TEXTURE_FILE = /_diff_(\d+)_[a-z](?:_[a-z]+)?\.ytd$/;
const SHOP_MARK = "<ShopPedApparel";
const SHOP_HEAD_BYTES = 600;

/* Таблицы языков игры: заплатка в `update.rpf` (общие строки) и таблица самого дополнения (его вещи). Языки — те пять, что есть у игры и у Astral (`game-names.js`). */
const updateLanguagePath = (language) => `x64/patch/data/lang/${GAME_LANGUAGE_FILES[language]}_rel.rpf`;
const packLanguagePath = (language) => `x64/data/lang/${GAME_LANGUAGE_FILES[language]}dlc.rpf`;
const BASE_MODEL_ARCHIVES = ["models/cdimages/streamedpeds_mp.rpf", "models/cdimages/streamedpedprops.rpf"];
const NO_TEXT = { size: 0, get: () => "" };
const BLANK_TEXTS = { label: "", name: "", nameEn: "" };
const ENTRY_KEYS = ["component", "prop", "drawable", "textures", "label"];

/*
 * 4 — у вещи записаны доп. модели (`alternates`: `hair_003_u_1.ydd`…), заменёнка пишет и их (14.11.2026).
 * 5 — копии файлов в нескольких архивах (`overlaps`) и порядок загрузки паков (`order`): патч-пак (`patchdayNNng`, `mppatchesng`…) держит свою копию файла вещи и игра грузит её
 *     позже пака вещи, так что запись в пак вещи не видна в игре (15.11.2026: `lowr_000_r.ydd` luxe_01 — копия в `patchday27ng`, лист c жилета `january2016` — в `patchday9ng`).
 * 6 — копии только из ПОДКЛЮЧЁННЫХ архивов пака (`content.xml`, правка `update.rpf:dlc_patch/<пак>/content.xml` главнее): «спящий» вложенный архив игра не читает, и запись в него уходила бы мимо игры;
 *     не прочитанный `dlclist.xml` помечает оглавление неполным (раньше порядок молча пустел, и копии не находились).
 * 8 — штатные подпакеты пака (`dlc1.rpf`, `dlc2.rpf`): у `mpheist4`, `mpbattle`, `mpsecurity` все модели и расцветки одежды лежат в них, у `mptuner` — мужские (22.11.2026); у вещи из подпакета поле `archive` — откуда читать, таблицы языков берутся и оттуда.
 * 7 — названия вещей на пяти языках игры (`names`: ru, en, de, fr, pl — строки `global.gxt2` каждого языка по ярлыку вещи, 17.11.2026); `name` и `nameEn` прежние.
 */
export const INDEX_VERSION = 8;

// Таблицы текстур по объекту «имя файла -> размер».
const textureTables = new WeakMap();

function digestOf(text) {
  const hash = createHash("sha256");
  hash.update(text);
  return hash.digest("hex");
}

// Вызов под перехватом: { value } при успехе, null при любом сбое (в том числе синхронном).
async function attempt(call) {
  try {
    return { value: await call() };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Память потока и идущие сборки
// ---------------------------------------------------------------------------

const stopTimer = (record) => clearTimeout(record?.timer);

class IndexShelf {
  constructor() {
    this.held = new Map(); // путь кэша -> { fingerprint, index, timer }
    this.running = new Map(); // путь кэша -> { fingerprint, promise }
  }

  // Запоминает оглавление на MEMO_MS и возвращает его.
  keep(cacheFile, fingerprint, index) {
    stopTimer(this.held.get(cacheFile));
    const timer = setTimeout(() => this.held.delete(cacheFile), MEMO_MS);
    const record = { fingerprint, index, timer };
    timer.unref?.();
    this.held.set(cacheFile, record);
    return index;
  }

  fromMemory(cacheFile, fingerprint) {
    const record = this.held.get(cacheFile);
    if (record?.fingerprint !== fingerprint) return null;
    return { value: this.keep(cacheFile, fingerprint, record.index) };
  }

  fromRunning(cacheFile, fingerprint) {
    const sibling = this.running.get(cacheFile);
    if (sibling?.fingerprint !== fingerprint) return null;
    return { value: sibling.promise };
  }

  // Заводит запись об идущей сборке; снимается, когда сборка закончилась и запись ещё своя.
  begin(cacheFile, fingerprint, promise) {
    this.running.set(cacheFile, { fingerprint, promise });
    return promise.finally(() => this.release(cacheFile, promise));
  }

  release(cacheFile, promise) {
    if (this.running.get(cacheFile)?.promise === promise) this.running.delete(cacheFile);
  }

  forget() {
    for (const record of this.held.values()) stopTimer(record);
    [this.held, this.running].forEach((table) => table.clear());
  }
}

const shelf = new IndexShelf();

// ---------------------------------------------------------------------------
// Файлы игры
// ---------------------------------------------------------------------------

export function gameFiles(gameRoot, keys) {
  const packsDir = path.join(gameRoot, "update", "x64", "dlcpacks");
  const updateFile = () => path.join(gameRoot, "update", "update.rpf");
  const baseFile = () => path.join(gameRoot, BASE_ARCHIVE);
  const openAt = (file) => openRpfFile(file, { keys, nested: false });
  const subpackPath = (pack, file) => path.join(packsDir, pack, file);

  const describe = async (tag, file) => {
    const pending = fs.stat(file);
    let info;
    try {
      info = await pending;
    } catch {
      info = null;
    }
    return info ? `${tag}:${info.size}:${Math.floor(info.mtimeMs)}` : `${tag}:-`;
  };

  async function fingerprint() {
    const stamps = [];
    for (const [tag, fileOf] of [["update", updateFile], ["base", baseFile]]) {
      stamps.push(await describe(tag, fileOf()));
    }
    for (const pack of await this.listPacks()) {
      stamps.push(await describe(pack, path.join(packsDir, pack, "dlc.rpf")));
      /* Подпакеты — тоже архивы пака: сменился `dlc1.rpf` — оглавление устарело. */
      for (const file of await this.listSubpacks(pack).catch(() => [])) stamps.push(await describe(`${pack}/${file}`, subpackPath(pack, file)));
    }
    return digestOf(stamps.join("|"));
  }

  async function listPacks() {
    const pending = fs.readdir(packsDir, { withFileTypes: true });
    let found;
    try {
      found = await pending;
    } catch {
      found = [];
    }
    return found.flatMap((dirent) => (dirent.isDirectory() ? [dirent.name] : [])).sort();
  }

  /* Штатные подпакеты пака — файлы `dlc1.rpf`, `dlc2.rpf`… рядом с `dlc.rpf` (`subPackCount` в его `setup2.xml` равен их числу у всех паков игры): по факту наличия, по порядку номеров; дыра в нумерации не мешает.
     Нет папки пака — пусто; любая другая ошибка перечисления уходит наверх (`openSubpacks` помечает оглавление неполным), а не считается «подпакетов нет». */
  async function listSubpacks(pack) {
    let entries;
    try {
      entries = await fs.readdir(path.join(packsDir, pack), { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    return entries
      .flatMap((dirent) => {
        const hit = dirent.isFile() ? /^dlc(\d+)\.rpf$/i.exec(dirent.name) : null;
        return hit && Number(hit[1]) > 0 ? [{ number: Number(hit[1]), name: dirent.name }] : [];
      })
      .sort((left, right) => left.number - right.number)
      .map((entry) => entry.name);
  }

  const openUpdate = () => openAt(updateFile());
  const openPack = (name) => openAt(path.join(packsDir, name, "dlc.rpf"));
  const openSubpack = (name, file) => openAt(subpackPath(name, file));
  const openBase = () => openAt(baseFile());

  return { gameRoot, fingerprint, openUpdate, listPacks, listSubpacks, openPack, openSubpack, openBase };
}

// ---------------------------------------------------------------------------
// Текстуры вещи
// ---------------------------------------------------------------------------

function indexTextures(files) {
  const hits = [];
  for (const [name, size] of files) {
    const hit = name.endsWith(".ytd") ? TEXTURE_FILE.exec(name) : null;
    if (hit) hits.push([`${name.slice(0, hit.index)}|${hit[1]}`, { name, size }]);
  }
  const table = new Map();
  for (const [key, entry] of hits) {
    const bucket = table.get(key);
    if (bucket) bucket.push(entry);
    else table.set(key, [entry]);
  }
  return table;
}

// Доп. модели одной папки по ключу «компонент|номер» — одним проходом по файлам.
const alternateTables = new WeakMap();
function indexAlternates(files) {
  const table = new Map();
  for (const name of files.keys()) {
    const parsed = name.endsWith(".ydd") ? parseAlternate(name) : null;
    if (!parsed) continue;
    const key = `${parsed.component}|${String(parsed.drawable).padStart(3, "0")}`;
    if (table.has(key)) table.get(key).push(name);
    else table.set(key, [name]);
  }
  return table;
}

/**
 * Доп. модели вещи (`hair_003_u_1.ydd`, `_2`…): имена файлов той же папки с суффиксом её основной модели, по возрастанию номера варианта. Игра подставляет их вместо основной по
 * `pedalternatevariations.meta` (при маске, капюшоне, куртке), поэтому заменёнка пишет и их. Основной модели нет или у вещи нет вариантов — пусто.
 */
export function alternatesInPlace(files, component, drawable, model) {
  if (!files || !model) return [];
  if (!alternateTables.has(files)) alternateTables.set(files, indexAlternates(files));
  const names = alternateTables.get(files).get(`${String(component)}|${String(drawable).padStart(3, "0")}`);
  if (!names) return [];
  const suffix = /_([ur]).ydd$/i.exec(String(model))?.[1]?.toLowerCase() || null;
  return alternatesOf(names, String(component), drawable, suffix).map((item) => item.name);
}

export function texturesOf(files, component, drawable) {
  if (!textureTables.has(files)) textureTables.set(files, indexTextures(files));
  const table = textureTables.get(files);
  const found = table.get(`${String(component)}|${String(drawable).padStart(3, "0")}`) ?? [];
  /* Порядок расцветок вещи — общий сравниватель пакета (`compareColourFiles`): плитка и `colourStubs` считают по нему же. */
  return found.slice().sort(compareColourFiles);
}

// ---------------------------------------------------------------------------
// Места файлов моделей
// ---------------------------------------------------------------------------

// Файловые записи каталога архива (папки пропускаются), лениво.
function* fileEntries(archive) {
  for (const entry of archive.entries) {
    if (entry.kind !== "directory") yield entry;
  }
}

// Строки «папка пола -> файл -> размер» по записям вложенного архива моделей.
function* modelRows(entries) {
  for (const entry of entries) {
    if (entry.kind === "directory") continue;
    const parts = FOLDER_AND_FILE.exec(entry.path);
    if (!parts || !GENDER_FOLDER.test(parts[2])) continue;
    const [, dir, folder, file] = parts;
    yield { dir, folder, file, size: Number(entry.size ?? entry.storedSize) || 0 };
  }
}

// Имя папки (нижний регистр) -> места { dir, files: Map(имя файла -> размер) } в порядке архивов.
class ModelFolders {
  constructor() {
    this.byName = new Map();
  }

  [Symbol.iterator]() {
    return this.byName[Symbol.iterator]();
  }

  /* `archive` — подпакет (`update/x64/dlcpacks/<пак>/dlc1.rpf`), если место лежит не в `dlc.rpf` пака; у обычного места поля нет. */
  addPlace(folder, dir, archive = null) {
    const place = { dir, files: new Map(), ...(archive ? { archive } : {}) };
    const key = folder.toLowerCase();
    this.byName.set(key, [...(this.byName.get(key) ?? []), place]);
    return place;
  }

  // Оглавление одного архива: место — полный путь папки без учёта регистра.
  take(entries, archive = null) {
    const slots = new Map();
    for (const row of modelRows(entries)) {
      const slot = row.dir.toLowerCase();
      if (!slots.has(slot)) slots.set(slot, this.addPlace(row.folder, row.dir, archive));
      slots.get(slot).files.set(row.file, row.size);
    }
  }

  // Первое место из перечисленных папок, где есть файл модели: _u, затем _r, затем без суффикса.
  find(wanted, component, drawable) {
    const stem = `${component}_${String(drawable).padStart(3, "0")}`;
    const candidates = ["_u.ydd", "_r.ydd", ".ydd"].map((tail) => stem + tail);
    for (const place of wanted.flatMap((folder) => this.byName.get(folder) ?? [])) {
      const model = candidates.find((name) => place.files.has(name));
      if (model) return { place, model };
    }
    return null;
  }
}

/*
 * Файлы вещей по всем архивам: «папка/файл» (нижний регистр) -> где он лежит. Файл в двух и более архивах — копия: игра берёт ту, что грузится позже (порядок `dlclist.xml`),
 * и запись в пак вещи при копии в патч-паке не видна. В оглавление идут только такие файлы (`overlaps`: ключ -> `[[пак, каталог вложенного архива]]`, пак базы — пустая строка).
 */
class CopyBook {
  constructor() {
    this.byKey = new Map();
  }

  /*
   * `mounted` — архивы пака, которые он подключает (`mountedArchives`); `null` или пустой — списка нет. Список, где не нашлось ни одного вложенного архива пака, — чужой формат `content.xml`: пак считается целым,
   * как у `activeEntries` (`game-file-index.js`).
   */
  note(pack, folders, mounted = null) {
    const nestedOf = (dir) => /^(.*?[.]rpf)/i.exec(String(dir))?.[1]?.toLowerCase() ?? null;
    const all = [...folders].flatMap(([, places]) => places.map((place) => nestedOf(place.dir)));
    const filter = Boolean(mounted?.size) && all.some((nested) => nested && mounted.has(nested));
    for (const [folder, places] of folders) {
      for (const place of places) {
        if (filter) {
          const nested = nestedOf(place.dir);
          if (nested && !mounted.has(nested)) continue;
        }
        for (const file of place.files.keys()) {
          const key = `${folder}/${file.toLowerCase()}`;
          const list = this.byKey.get(key);
          if (list) list.push([pack, place.dir]);
          else this.byKey.set(key, [[pack, place.dir]]);
        }
      }
    }
  }

  overlaps() {
    const out = {};
    for (const [key, list] of this.byKey) {
      if (new Set(list.map(([pack, dir]) => `${pack}|${dir}`)).size > 1) out[key] = list;
    }
    return out;
  }
}

// Вложенный архив открывается под перехватом; сбой — пропуск.
async function absorb(folders, archive, file, from = null) {
  const got = await attempt(() => archive.open(file));
  if (got) folders.take(got.value.entries, from);
}

function* modelArchivePaths(archive) {
  for (const entry of fileEntries(archive)) {
    if (MODEL_ARCHIVE_PATH.test(entry.path) && !MODEL_ARCHIVE_SKIP.test(entry.path)) yield entry.path;
  }
}

/* Архивы одежды пака: сначала `dlc.rpf`, затем подпакеты по порядку (у `mpheist4`, `mpbattle`, `mpsecurity` в `dlc.rpf` их нет вовсе, у `mptuner` мужской — в `dlc1.rpf`). */
async function readModelFolders(archive, subpacks = []) {
  const folders = new ModelFolders();
  for (const file of modelArchivePaths(archive)) await absorb(folders, archive, file);
  for (const sub of subpacks) for (const file of modelArchivePaths(sub.archive)) await absorb(folders, sub.archive, file, sub.file);
  return folders;
}

// ---------------------------------------------------------------------------
// Магазинные файлы, патчи, тексты
// ---------------------------------------------------------------------------

// Таблица языка из вложенного архива; любой сбой даёт пустую таблицу.
async function tableAt(archive, file) {
  try {
    const nested = await archive.open(file);
    const bytes = await nested.read(`${file}/global.gxt2`);
    return parseGxt2(bytes);
  } catch {
    return NO_TEXT;
  }
}

/* Таблицы всех пяти языков игры одного архива: код языка Astral → таблица (нет файла языка — пустая). */
async function readTables(archive, pathOf) {
  const tables = {};
  for (const language of GAME_NAME_LANGUAGES) tables[language] = await tableAt(archive, pathOf(language));
  return tables;
}

/* Таблицы пака: свои строки у `dlc.rpf` и у подпакетов (у `mpbattle` они только в `dlc1.rpf`); непустые складываются, раньше названная строка главнее. */
function mergedTable(tables) {
  const filled = tables.filter((table) => table.size > 0);
  if (filled.length < 2) return filled[0] || NO_TEXT;
  return { size: filled.reduce((sum, table) => sum + table.size, 0), get: (label) => filled.reduce((found, table) => found || table.get(label), "") };
}

async function readPackTables({ archive, subpacks = [] }) {
  const tables = {};
  for (const language of GAME_NAME_LANGUAGES) {
    const at = packLanguagePath(language);
    tables[language] = mergedTable([await tableAt(archive, at), ...(await Promise.all(subpacks.map((sub) => tableAt(sub.archive, at))))]);
  }
  return tables;
}

const NO_TEXTS = Object.freeze(Object.fromEntries(GAME_NAME_LANGUAGES.map((language) => [language, NO_TEXT])));

// Записи патчей update.rpf: [папка дополнения как в пути, путь записи].
function* patchEntries(update) {
  for (const entry of update.entries) {
    const hit = PATCH_PATH.exec(entry.path);
    if (hit && entry.kind !== "directory") yield [hit[1], entry.path];
  }
}

async function patchMetaOf(update, file) {
  const pending = update.read(file);
  const bytes = await pending.catch(() => null);
  if (!bytes) return null;
  const text = Buffer.from(bytes).toString("utf8");
  return text.includes(SHOP_MARK) ? parseShopMeta(text) : null;
}

// Имя папки дополнения -> { male, female }.
async function readPatches(update) {
  const patches = new Map();
  for (const [folder, file] of patchEntries(update)) {
    const meta = await patchMetaOf(update, file);
    if (meta) patches.set(folder, { ...patches.get(folder), [meta.gender]: meta });
  }
  return patches;
}

async function shopMetaOf(archive, file) {
  const got = await attempt(() => archive.read(file));
  if (!got) return null;
  const bytes = got.value;
  const head = Buffer.from(bytes.subarray(0, SHOP_HEAD_BYTES));
  if (!head.toString("utf8").includes(SHOP_MARK)) return null;
  return parseShopMeta(Buffer.from(bytes).toString("utf8"));
}

// Пол -> разобранный магазинный файл дополнения (позднее перекрывает раннее).
async function readShops(archive) {
  const found = [];
  for (const entry of fileEntries(archive)) {
    if (!SHOP_PATH.test(entry.path)) continue;
    const meta = await shopMetaOf(archive, entry.path);
    if (meta) found.push([meta.gender, meta]);
  }
  return Object.fromEntries(found);
}

// Название вещи: первая непустая запись по цепочке таблиц.
const firstText = (tables, label) => tables.reduce((found, table) => found || table.get(label), "");

/* Таблицы одного языка в порядке силы: таблица пака, затем заплатка `update.rpf`. `texts` — `{ pack, base }`, каждая по языкам. */
const tablesOf = (texts, language) => [texts.pack[language], texts.base[language]];

/* Что вещь называется на каждом языке игры: только найденные строки; ни одной — `null`. */
function namesOf(texts, label) {
  return cleanGameNames(Object.fromEntries(GAME_NAME_LANGUAGES.map((language) => [language, firstText(tablesOf(texts, language), label)])));
}

// ---------------------------------------------------------------------------
// Вещи
// ---------------------------------------------------------------------------

// Сведения о файле модели вещи; без найденного места — пустые.
function modelFacts(item, found) {
  if (!found) return { model: null, modelSize: 0, dir: null, textureFiles: [] };
  const { place, model } = found;
  const alternates = alternatesInPlace(place.files, item.component, item.drawable, model);
  return {
    model,
    modelSize: place.files.get(model) || 0,
    dir: place.dir,
    ...(place.archive ? { archive: place.archive } : {}),
    textureFiles: texturesOf(place.files, item.component, item.drawable),
    ...(alternates.length ? { alternates } : {}),
  };
}

function shopItem(entry, found, texts) {
  const item = {};
  for (const key of ENTRY_KEYS) item[key] = entry[key];
  /* `name` — русское название, а нет его — английское (как было); `nameEn` — английское; `names` — строка игры на каждом из пяти языков. */
  item.name = firstText([...tablesOf(texts, "ru"), ...tablesOf(texts, "en")], item.label);
  item.nameEn = firstText(tablesOf(texts, "en"), item.label);
  const names = namesOf(texts, item.label);
  if (names) item.names = names;
  return Object.assign(item, modelFacts(item, found));
}

// Вещи по магазинному файлу и папки, которые он уже разобрал.
function itemsFromShop(meta, folders, texts) {
  const propsFolder = meta.folder.replace(SHOP_FOLDER_HEAD, "$1_p_");
  const items = summarizeShopItems(meta.items).map((entry) => {
    const where = entry.prop ? [propsFolder, `${meta.folder}_p`] : [meta.folder];
    return shopItem(entry, folders.find(where, entry.component, entry.drawable), texts);
  });
  return { items, known: [meta.folder, propsFolder] };
}

// Файлы моделей в папках пола, которые магазин не разбирал.
function* modelFiles(folders, ped, known) {
  const chosen = [...folders].filter(([folder]) => !known.includes(folder) && folder.startsWith(ped));
  for (const [folder, places] of chosen) {
    const inProps = PROP_FOLDER.test(folder);
    const rows = places.flatMap((place) => [...place.files].map(([file, size]) => ({ place, file, size })));
    for (const row of rows) {
      const hit = MODEL_FILE.exec(row.file);
      if (hit && hit[1].startsWith("p_") === inProps) yield { ...row, component: hit[1], digits: hit[2], inProps };
    }
  }
}

function fileItem({ place, file, size, component, digits, inProps }) {
  const drawable = Number(digits);
  const textureFiles = texturesOf(place.files, component, drawable);
  const alternates = alternatesInPlace(place.files, component, drawable, file);
  return Object.assign(
    { component, prop: inProps, drawable, textures: Math.max(textureFiles.length, 1) },
    BLANK_TEXTS,
    { model: file, modelSize: size, dir: place.dir, ...(place.archive ? { archive: place.archive } : {}), textureFiles, ...(alternates.length ? { alternates } : {}) },
  );
}

function itemsFromFiles(folders, ped, known, shopItems) {
  const made = Array.from(modelFiles(folders, ped, known), (row) => fileItem(row));
  return made.filter((item) => !shopItems.some((one) => one.dir === item.dir && one.model === item.model));
}

// Что есть у пола: папка, вещи по магазину и вещи по файлам.
function genderEntry(meta, folders, texts, ped) {
  const shop = meta && meta.items.length ? itemsFromShop(meta, folders, texts) : { items: [], known: [] };
  const fileItems = itemsFromFiles(folders, ped, shop.known, shop.items);
  return { folder: meta ? meta.folder : "", shopItems: shop.items, fileItems };
}

function attachGender(collection, key, { folder, shopItems, fileItems }) {
  if (!shopItems.length && !fileItems.length) return;
  collection[key] = { folder, named: shopItems.length > 0, items: [...shopItems, ...fileItems] };
}

const hasGender = (collection) => GENDERS.some(([key]) => collection[key]);

// ---------------------------------------------------------------------------
// Сборка
// ---------------------------------------------------------------------------

// Что читается из архива дополнения, по порядку.
const PACK_STEPS = [
  ["shops", ({ archive }) => readShops(archive)],
  ["folders", ({ archive, subpacks }) => readModelFolders(archive, subpacks)],
  ["tables", (gathered) => readPackTables(gathered)],
];

// Дополнение: что есть в пакете и в патче для каждого пола.
async function assemblePack(name, archive, patches, baseTables, copies = null, patchContent = new Map(), subpacks = []) {
  const gathered = { archive, subpacks };
  for (const [slot, step] of PACK_STEPS) gathered[slot] = await step(gathered);
  /* Файлы пака — в книгу копий до любых отказов ниже: патч-пак с одними листами (без моделей) вещей не даёт, но перекрывает чужие файлы. */
  /* Подключённые архивы: правка `dlc_patch/<пак>/content.xml` главнее собственного `content.xml` пака. */
  const own = patchContent.get(name.toLowerCase()) ?? (await attempt(async () => Buffer.from(await archive.read("content.xml")).toString("utf8")))?.value;
  copies?.note(name, gathered.folders, own ? mountedArchives(own) : null);
  const texts = { pack: gathered.tables, base: baseTables };

  const collection = { pack: name };
  collection.title = collectionTitle(name);
  collection.patched = patches.has(name);
  collection.archive = `update/x64/dlcpacks/${name}/dlc.rpf`;

  const patch = patches.get(name);
  for (const [key, ped] of GENDERS) {
    const meta = patch?.[key] ?? gathered.shops[key];
    attachGender(collection, key, genderEntry(meta, gathered.folders, texts, ped));
  }
  return hasGender(collection) ? collection : null;
}

// Базовая игра: только вещи по файлам из двух вложенных архивов x64v.rpf.
async function assembleBase(io, incomplete = [], copies = null) {
  const opened = await attempt(() => io.openBase?.());
  /* Базовая игра не открылась (а читатель умеет её открывать) — вещей базы в оглавлении нет не потому, что их нет в игре. */
  if (!opened && typeof io.openBase === "function") incomplete.push("x64v.rpf");
  const archive = opened?.value;
  if (!archive) return null;
  const folders = new ModelFolders();
  for (const file of BASE_MODEL_ARCHIVES) await absorb(folders, archive, file);
  copies?.note("", folders);
  const collection = Object.fromEntries([
    ["pack", ""],
    ["title", BASE_SHOP],
    ["base", true],
    ["patched", false],
    ["archive", BASE_ARCHIVE],
  ]);
  for (const [key, ped] of GENDERS) {
    attachGender(collection, key, { folder: ped, shopItems: [], fileItems: itemsFromFiles(folders, ped, [], []) });
  }
  return hasGender(collection) ? collection : null;
}

/* `failed` — update.rpf не открылся: без него нет заплаток паков, и оглавление неполное. */
async function openUpdateQuietly(io) {
  try {
    return { archive: await io.openUpdate(), failed: false };
  } catch {
    return { archive: null, failed: true };
  }
}

// Сообщает о начале работы с очередным дополнением: сколько уже начато и сколько всего.
function progressReporter(onProgress, packs) {
  let done = 0;
  return (pack) => {
    onProgress?.({ done, total: packs.length, pack });
    done += 1;
  };
}

/* Подпакеты пака, что открылись; не открывшийся делает оглавление неполным (в `incomplete` — `пак/dlcN.rpf`). Читатель без подпакетов (`listSubpacks` нет) — как раньше. */
async function openSubpacks(io, name, incomplete) {
  if (typeof io.listSubpacks !== "function" || typeof io.openSubpack !== "function") return [];
  let files;
  try {
    files = await io.listSubpacks(name);
  } catch (error) {
    /* Не вышло перечислить (права, диск, антивирус): вещи подпакетов остаются как в 1.0.1, а оглавление помечено неполным — не «подпакетов нет». */
    console.warn(`[clothing-index] Подпакеты пака ${name} не перечислены: ${error?.code || ""} ${error?.message || error}`.replace(/\s+/g, " "));
    incomplete.push(`${name}/dlc*.rpf`);
    return [];
  }
  const found = [];
  for (const file of files || []) {
    const got = await attempt(() => io.openSubpack(name, file));
    if (got) found.push({ archive: got.value, file: `update/x64/dlcpacks/${name}/${file}` });
    else incomplete.push(`${name}/${file}`);
  }
  return found;
}

export async function buildGameClothingIndex({ io, onProgress } = {}) {
  /* Что не прочиталось (замок, нет ключей, битый архив): оглавление неполное, и «вещи нет» по нему — не доказательство (находка 3 ревью 14.11.2026). */
  const incomplete = [];
  const opening = await openUpdateQuietly(io);
  const update = opening.archive;
  if (opening.failed) incomplete.push("update.rpf");
  const patches = update ? await readPatches(update) : new Map();
  const baseTables = update ? await readTables(update, updateLanguagePath) : NO_TEXTS;

  const packs = await io.listPacks();
  const report = progressReporter(onProgress, packs);
  const collections = [];
  const copies = new CopyBook();
  /* `update.rpf:dlc_patch/<пак>/content.xml` — правка списка подключаемых архивов пака (главнее его собственного `content.xml`). */
  const patchContent = new Map();
  for (const entry of update?.entries || []) {
    const hit = /^dlc_patch\/([^/]+)\/content\.xml$/i.exec(entry.path);
    if (!hit || entry.kind === "directory") continue;
    const read = await attempt(async () => Buffer.from(await update.read(entry.path)).toString("utf8"));
    if (read?.value) patchContent.set(hit[1].toLowerCase(), read.value);
  }
  for (const name of packs) {
    report(name);
    const opened = await attempt(() => io.openPack(name));
    const subpacks = opened ? await openSubpacks(io, name, incomplete) : [];
    /* Битый meta одного пака (редукс) не должен ронять сборку всего оглавления — пак пропускается и назван. */
    const assembled = opened ? await attempt(() => assemblePack(name, opened.value, patches, baseTables, copies, patchContent, subpacks)) : null;
    if (!assembled) incomplete.push(name);
    if (assembled?.value) collections.push(assembled.value);
  }

  const base = await assembleBase(io, incomplete, copies);
  /* Порядок загрузки паков — `dlclist.xml` из `update.rpf`: из него видно, чья копия файла грузится позже. Не прочитался — порядка нет, а копии без порядка в оглавлении не считаются перекрытием. */
  const order = update ? await attempt(async () => dlcOrder(Buffer.from(await update.read("common/data/dlclist.xml")).toString("utf8"))) : null;
  /* Порядок не прочитался (`dlclist.xml` не открылся, пуст, другой формат): оглавление неполное, и вещи с копиями без порядка не ставятся вслепую «на месте» (ревью 15.11, №4). */
  if (update && !order?.value?.length) incomplete.push("dlclist.xml");
  return {
    version: INDEX_VERSION,
    builtAt: Date.now(),
    collections: base ? [base, ...collections] : collections,
    overlaps: copies.overlaps(),
    order: order?.value || [],
    ...(incomplete.length ? { incomplete } : {}),
  };
}

// ---------------------------------------------------------------------------
// Чтение с кэшем
// ---------------------------------------------------------------------------

const cachePathFor = (stateDir, gameRoot) => {
  const stem = digestOf(String(gameRoot || "game").toLowerCase()).slice(0, 16);
  return path.join(stateDir, "clothing-index", stem + ".json");
};

const parseOrNull = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// Из файла кэша: годен при своей версии и совпавшем отпечатке.
async function fromDisk(cacheFile, fingerprint) {
  const stored = await fs.readFile(cacheFile, "utf8").then(parseOrNull, () => null);
  const usable = stored?.version === INDEX_VERSION && stored.fingerprint === fingerprint;
  return usable ? { value: shelf.keep(cacheFile, fingerprint, stored) } : null;
}

// Запись файла кэша через временный файл рядом.
async function saveIndexFile(cacheFile, index) {
  let scratch = null;
  const plan = [
    ["mkdir", () => [path.dirname(cacheFile), { recursive: true }]],
    ["writeFile", () => [(scratch = `${cacheFile}.${process.pid}.${randomUUID()}.tmp`), JSON.stringify(index)]],
    ["rename", () => [scratch, cacheFile]],
  ];
  for (const [method, argsOf] of plan) await fs[method](...argsOf());
}

function produce(files, onBuild, onProgress) {
  onBuild?.();
  return buildGameClothingIndex({ io: files, onProgress });
}

async function buildAndStore({ files, fingerprint, cacheFile, onBuild, onProgress }) {
  const built = await produce(files, onBuild, onProgress);
  const index = Object.assign(built, { fingerprint });
  /* Кэш — как был, вместе с пометкой `incomplete`: прогрев не пересобирает оглавление при каждом запуске, а вещь, которой в неполном оглавлении нет, ищется заново с обновлением
     (`placeInReadIndex` в `clothing-pack-place.js`), и сбой, что прошёл, затирается полным индексом. Сбой записи кэша (диск, права, антивирус) собранному индексу не мешает: он годен. */
  await saveIndexFile(cacheFile, index).catch(() => {});
  return shelf.keep(cacheFile, fingerprint, index);
}

async function sourceFor(gameRoot, keysDirectory) {
  const keys = keysDirectory ? await keysFromDirectory(keysDirectory) : null;
  return gameFiles(gameRoot, keys);
}

export async function readGameClothingIndex(
  { gameRoot, stateDir, keysDirectory, io = null, onProgress = null },
  { refresh = false, onBuild = null } = {},
) {
  const files = io || (await sourceFor(gameRoot, keysDirectory));
  const fingerprint = await files.fingerprint();
  const cacheFile = cachePathFor(stateDir, gameRoot);

  const hit = refresh
    ? null
    : shelf.fromMemory(cacheFile, fingerprint) ??
      (await fromDisk(cacheFile, fingerprint)) ??
      shelf.fromRunning(cacheFile, fingerprint);
  if (hit) return hit.value;

  return shelf.begin(cacheFile, fingerprint, buildAndStore({ files, fingerprint, cacheFile, onBuild, onProgress }));
}

export function forgetGameClothingIndex() {
  shelf.forget();
}

// ---------------------------------------------------------------------------
// Выборки по оглавлению
// ---------------------------------------------------------------------------

// Коллекции дополнений (базовая пропускается), лениво.
function* liveCollections(index) {
  for (const collection of index?.collections || []) {
    if (!collection.base) yield collection;
  }
}

// Пары { collection, item } по всем вещам пола, лениво.
function* pairsOf(index, gender) {
  for (const collection of liveCollections(index)) {
    for (const item of collection[gender]?.items || []) yield { collection, item };
  }
}

function* matchingPairs(index, gender, component) {
  for (const pair of pairsOf(index, gender)) {
    const { item } = pair;
    if (item.component === component && !item.prop && item.model) yield pair;
  }
}

function pickItems(index, gender, component) {
  return Array.from(matchingPairs(index, gender, component));
}

export function componentItems(index, gender = "male", component = "berd") {
  return pickItems(index, gender, component);
}

export function maskItems(index, gender = "male") {
  return pickItems(index, gender, "berd");
}

export { DLC_TITLES as COLLECTION_TITLES, collectionTitle };
