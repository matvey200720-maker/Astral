import { GENDER_LABELS, clothingOf, isTattooPack } from "../../../../features/clothing/clothing-catalog.js";
import { modProjects } from "../../../../features/catalog/catalog-projects.js";
import { cloudCatalogIDPattern } from "../../desktopShellDefaults.js";
import { decorationZone } from "@modovik/clothing/decorations";
import { createModelEntry } from "@modovik/gun-studio/models";
import * as freemode from "@modovik/clothing/gender";
import { cardPassesGate } from "@modovik/clothing/quality-gate";
import { cleanGameNames, pickGameName, searchableGameNames } from "@modovik/clothing/game-names";
import { getCloudDownloadGrant } from "../../../../api.js";
import { currentUiLanguage, tr } from "../../../../locales/ui.js";
import { shownShop } from "../../../../features/clothing/item-title.js";
import { trKey } from "./gun-copy.js";

// Где вещь стоит на свободном персонаже и как называется её файл текстуры.

export function clothingWearOf(slotId, gender = "male") {
  const place = PLACES[slotId];
  if (!place) return null;
  const [, component] = place;
  return {
    gender: gender === "female" ? "female" : "male",
    component,
    prop: component.startsWith("p_"),
  };
}

export const clothingTextureFile = (slotId, variant) => {
  if (!Number.isInteger(variant) || !PLACES[slotId]) return "";
  const [folder, component] = PLACES[slotId];
  const dir = freemode.folderOfGender(folder, freemode.variantGender(variant));
  const number = String(freemode.localVariant(variant)).padStart(3, "0");
  return `${dir}/${component}_diff_${number}_*.ytd`;
};

// Пол вещи по id вида game:<слот>-<число>: слот из a-z и дефисов, число из цифр.
function gameIdNumber(text) {
  if (!text.startsWith(GAME_PREFIX)) return null;
  const tail = text.slice(GAME_PREFIX.length);
  const dash = tail.lastIndexOf("-");
  if (dash < 1) return null;
  const slotPart = tail.slice(0, dash);
  const digits = tail.slice(dash + 1);
  const isSlotChar = (ch) => ch === "-" || (ch >= "a" && ch <= "z");
  const isDigit = (ch) => ch >= "0" && ch <= "9";
  if (!digits || ![...slotPart].every(isSlotChar) || ![...digits].every(isDigit)) return null;
  return Number(digits);
}

export function modelIdGender(id) {
  const number = gameIdNumber(String(id || ""));
  return number === null ? null : freemode.variantGender(number);
}

export const clothingItemName = (slotId, variant) => {
  const word = tr(WORDS[slotId] || WORD_OTHER);
  return slotId === NUMBERLESS_SLOT ? word : `${word} №${freemode.localVariant(variant)}`;
};

// Память окна о вещах из игры: имя, файл, «Заменяет» и номера-псевдонимы заплаток.

const tileKey = (slotId, variant) => `${slotId}-${variant}`;
const tileId = (slotId, variant) => `game:${tileKey(slotId, variant)}`;

export const gameExtraOf = (slotId, variant) => extraMemory.get(tileKey(slotId, variant)) ?? null;

export const gameAliasOf = (id) => aliasMemory.get(String(id || "")) ?? null;

function requireList(value) {
  if (!Array.isArray(value)) throw new TypeError(`Ожидался массив, пришло: ${value === null ? "null" : typeof value}`);
}

/*
 * Запись «Заменяет» самой вещи игры (`server: null`, тот же номер вещи в игре) получает строки игры по языкам: окно выбора («На что поставить?») строит из неё плитку «Советует автор» и склеивает с вещью ассортимента;
 * без строк игры русское имя записи вытесняло название на языке окна, и в немецком и французском окне плитка называлась по-русски (проверка в Electron 17.11.2026). Русское `name` записи не меняется: по нему вещь узнают
 * в установке. Запись ищется по номеру, а не по имени: у одноимённых вещей («вид 1») имя записи — без подписи, а имя вещи — с ней.
 */
function extraOf({ name, file, replaces, names, gameDrawable }) {
  const game = cleanGameNames(names);
  const records = Array.isArray(replaces) ? replaces : [];
  const own = (record) => Boolean(record) && !record.server && !record.names && (Number.isInteger(gameDrawable) ? record.drawable === gameDrawable : record.name === name);
  return {
    name: String(name),
    file: String(file || ""),
    replaces: game ? records.map((record) => (own(record) ? { ...record, names: game } : record)) : records,
  };
}

/*
 * Название вещи игры на языке окна (17.11.2026, решение владельца: так, как её называет сама GTA V на этом языке). Desktop присылает вместе с вещью строки игры по языкам (`names`),
 * номер вещи в игре (`gameDrawable`; не `drawable` — это имя модели для движка) и дополнение (`shop`); окно помнит их здесь, и название собирается на языке окна — при чтении списка и при смене языка (`localizeGameModels`), без нового чтения игры.
 *  1. Строка игры на языке окна по цепочке языка (`pickGameName`: у украинского игры нет — английская), с разбором подписи одноимённых («вид 2», «капюшон надет») на языке окна.
 *  2. Строки игры нет — запасное название по типу и номеру вещи на языке окна: «Маска №12 · Байкеры». По-русски вещь без строки игры по-прежнему зовётся именем Desktop.
 *  3. Сведений Desktop нет (штатные вещи, прежний ответ) — имя Desktop, а без него «Маска №12».
 */
const rawMemory = new Map();

const SUFFIX_VIEW = trKey("вид");
const SUFFIX_HOOD = trKey("капюшон надет");

function suffixWords(suffix) {
  if (suffix?.hood) return tr(SUFFIX_HOOD);
  return Number.isInteger(suffix?.view) ? `${tr(SUFFIX_VIEW)} ${suffix.view}` : "";
}

function neutralGameName(slotId, raw) {
  const word = tr(WORDS[slotId] || WORD_OTHER);
  if (slotId === NUMBERLESS_SLOT || !Number.isInteger(raw.gameDrawable)) return "";
  return `${word} №${raw.gameDrawable}${raw.shop ? ` · ${shownShop(raw.shop)}` : ""}`;
}

/* Своё название вещи, которой у игры в таблице нет (известные бронежилеты, большая сумка GTA5RP): Desktop присылает слова по-русски, как ключ словаря, и номер; на язык окна они переводятся здесь, при отрисовке. */
function ownGameName(raw) {
  if (!raw.nameWords) return "";
  const number = Number.isInteger(raw.nameNumber) ? ` №${raw.nameNumber}` : "";
  return `${tr(raw.nameWords)}${number}${raw.shop ? ` · ${shownShop(raw.shop)}` : ""}`;
}

function gameTitleOf(slotId, variant, raw, language) {
  const game = pickGameName(raw.names, language);
  if (game) return [game, suffixWords(raw.nameSuffix)].filter(Boolean).join(" · ");
  const own = ownGameName(raw);
  if (own) return own;
  const hasNeutral = Number.isInteger(raw.gameDrawable);
  if (hasNeutral && (raw.names || language !== "ru")) return neutralGameName(slotId, raw) || raw.name || clothingItemName(slotId, variant);
  return raw.name || clothingItemName(slotId, variant);
}

/**
 * Название вещи игры на языке окна — то, что стоит на её плитке в списке слота (`gameTile`). Строка комплекта, шапка окна выбора и подпись кнопки «?» берут его, а не русское имя Desktop (`gameExtraOf().name`):
 * то же русское имя держит группировку и крой вещи, и показом ему быть нельзя. Вещи, о которой окно ничего не помнит, — пустая строка (звавший берёт своё имя).
 */
export function gameItemTitle(slotId, variant, language = currentUiLanguage()) {
  const raw = rawMemory.get(tileKey(slotId, variant));
  return raw ? gameTitleOf(slotId, variant, raw, language) : "";
}

function rememberRaw(slotId, item) {
  const { name, names, gameDrawable, shop, nameSuffix, nameWords, nameNumber } = item;
  rawMemory.set(tileKey(slotId, item.variant), {
    nameWords: typeof nameWords === "string" ? nameWords : "",
    nameNumber: Number.isInteger(nameNumber) ? nameNumber : null,
    name: typeof name === "string" ? name : "",
    names: cleanGameNames(names),
    gameDrawable: Number.isInteger(gameDrawable) ? gameDrawable : null,
    shop: typeof shop === "string" ? shop : "",
    nameSuffix: nameSuffix && typeof nameSuffix === "object" ? nameSuffix : null,
  });
}

function gameTile(slotId, item) {
  const { variant, body } = item;
  const raw = rawMemory.get(tileKey(slotId, variant));
  return createModelEntry({
    source: "game",
    key: tileKey(slotId, variant),
    name: body ? tr("Тело персонажа") : gameTitleOf(slotId, variant, raw, currentUiLanguage()),
    slot: slotId,
    variant,
    body: Boolean(body),
    gender: freemode.variantGender(variant),
  });
}

export function gameClothingModels(slotId, variants = []) {
  requireList(variants);
  const tiles = [];
  for (const item of variants) {
    const variant = item?.variant;
    if (!Number.isInteger(variant) || variant < 0) continue;
    if (item.hidden) {
      if (Number.isInteger(item.aliasOf)) aliasMemory.set(tileId(slotId, variant), tileId(slotId, item.aliasOf));
      continue;
    }
    if (item.name) extraMemory.set(tileKey(slotId, variant), extraOf(item));
    rememberRaw(slotId, item);
    tiles.push(gameTile(slotId, item));
  }
  return tiles;
}

/**
 * Те же плитки с названиями на языке `language` — окно сменило язык, а список вещей игры не перечитывается. Плитка не из игры, тело персонажа и вещь, о которой окно ничего не помнит,
 * остаются как были; плитка с тем же названием — тем же объектом.
 */
export function localizeGameModels(entries, language = currentUiLanguage()) {
  return entries.map((entry) => {
    if (entry?.source !== "game" || entry.body || !Number.isInteger(entry.variant)) return entry;
    const raw = rawMemory.get(tileKey(entry.slot, entry.variant));
    if (!raw) return entry;
    const name = gameTitleOf(entry.slot, entry.variant, raw, language);
    return name === entry.name ? entry : Object.freeze({ ...entry, name });
  });
}

/** То же, что `gameItemTitle` (имя из ветки «остаток названий»): одна реализация на двоих, строка комплекта берёт `gameItemTitle` в поле `shown`. */
export const gameNameOf = gameItemTitle;

/** Названия вещи игры на всех языках игры — для поиска в панели слота: вещь находят по любому из них. */
export function gameSearchNames(entry) {
  if (entry?.source !== "game" || !Number.isInteger(entry.variant)) return [];
  return searchableGameNames(rawMemory.get(tileKey(entry.slot, entry.variant))?.names);
}

// Вещи каталога Astral той же категории.

function hasPackage(mod) {
  return Boolean(mod.manifest && mod.packageBaseUrl) || cloudCatalogIDPattern.test(String(mod.id));
}

function catalogItemOf(mod) {
  const id = String(mod.id);
  const block = clothingOf(mod);
  return Object.freeze({
    id,
    name: String(mod.name || id),
    cover: mod.cover || mod.image || "",
    model: typeof mod.model === "string" ? mod.model : "",
    gender: block?.gender ?? null,
    component: block?.component ?? null,
    category: block?.category ?? null,
    replaces: Array.isArray(block?.replaces) ? block.replaces : [],
    manifest: mod.manifest || null,
    packageBaseUrl: mod.packageBaseUrl || "",
    downloads: Number(mod.downloads) || 0,
    projects: [...modProjects(mod)],
  });
}

export function clothingCatalogItems(mods = []) {
  requireList(mods);
  const items = [];
  for (const mod of mods) {
    /* Ворота качества (11.11.2026): вещь, не прошедшая их, с выдачи снимается; здесь — защита для кэша и вещей, выложенных по старым правилам. */
    if (!mod?.id || isTattooPack(mod) || !hasPackage(mod) || !cardPassesGate(mod)) continue;
    items.push(catalogItemOf(mod));
  }
  return items;
}

// Тату сервера.

const tattooTitle = ({ zone, name, gender }) =>
  [decorationZone(zone)?.label, name, GENDER_LABELS[gender]].filter(Boolean).join(TITLE_SEPARATOR);

export function serverTattooModels(slotId, tattoos = []) {
  if (slotId !== TATTOO_SLOT) return [];
  requireList(tattoos);
  return tattoos.map((tattoo) =>
    createModelEntry({ source: "server", key: tattoo.key, name: tattooTitle(tattoo), slot: slotId }),
  );
}

export const serverTattooRef = (tattoo) => Object.fromEntries(REF_FIELDS.map((field) => [field, tattoo[field]]));

// Плитки каталога: у одноимённых вещей разного пола к имени добавляется пол.

function catalogTileName(item, gendersByName) {
  const mixed = item.gender && gendersByName.get(item.name).size > 1;
  return mixed ? `${item.name}${TITLE_SEPARATOR}${GENDER_LABELS[item.gender]}` : item.name;
}

export function catalogClothingModels(slotId, items = []) {
  requireList(items);
  const gendersByName = new Map();
  for (const { name, gender } of items) {
    if (!gendersByName.has(name)) gendersByName.set(name, new Set());
    gendersByName.get(name).add(gender);
  }
  return items.map((item) =>
    createModelEntry({
      source: "catalog",
      key: item.id,
      name: catalogTileName(item, gendersByName),
      slot: slotId,
      preview: item.cover,
      url: item.colour ? "" : item.model || "",
      gender: item.gender,
    }),
  );
}

export function catalogItemWear(item) {
  const gender = item?.gender;
  const component = item?.component;
  if (!gender || !component) return null;
  return { gender, component, prop: component.startsWith("p_") };
}

/* Пакет вещи каталога. `level` — насколько вещь нужна сейчас (`GRANT.*`, `grant-level.js`; по умолчанию выбор): очередь выдачи под пределом сервера стоит в Desktop (`grant-pacer.js`). */
export async function catalogPackageOf(item, { level } = {}) {
  if (item?.manifest && item.packageBaseUrl) {
    return { manifest: item.manifest, baseUrl: item.packageBaseUrl };
  }
  if (!cloudCatalogIDPattern.test(String(item?.id || ""))) {
    throw new Error(tr("У вещи каталога нет пакета."));
  }
  const grant = await (level ? getCloudDownloadGrant(item.id, level) : getCloudDownloadGrant(item.id));
  return { manifest: grant.manifest, baseUrl: grant.packageBaseUrl };
}

// Таблицы.

const GAME_PREFIX = "game:";
const TATTOO_SLOT = "tattoos";
const NUMBERLESS_SLOT = "government-clothing";
const TITLE_SEPARATOR = " · ";
const REF_FIELDS = ["directory", "archive", "entry", "txd", "texture", "collection", "name"];

const BODY = "mp_m_freemode_01";
const BODY_PROPS = `${BODY}_p`;
const BODY_MPLTS = `${BODY}_male_freemode_mplts`;

// категория -> [папка персонажа, компонент]; обычный объект, как и таблица слов ниже
const PLACES = {
  armor: [BODY, "task"],
  tshirts: [BODY, "jbib"],
  pants: [BODY, "lowr"],
  shoes: [BODY, "feet"],
  masks: [BODY, "berd"],
  hair: [BODY, "hair"],
  beards: [BODY, "berd"],
  hats: [BODY_PROPS, "p_head"],
  accessories: [BODY_PROPS, "p_eyes"],
  gloves: [BODY_MPLTS, "uppr"],
  bags: [BODY_MPLTS, "hand"],
};

const WORDS = {
  armor: trKey("Бронежилет"),
  tshirts: trKey("Верх"),
  pants: trKey("Штаны"),
  shoes: trKey("Обувь"),
  masks: trKey("Маска"),
  hair: trKey("Причёска"),
  beards: trKey("Борода"),
  hats: trKey("Головной убор"),
  accessories: trKey("Очки"),
  gloves: trKey("Перчатки"),
  bags: trKey("Сумка"),
  [NUMBERLESS_SLOT]: trKey("Форма патрульного"),
};
const WORD_OTHER = trKey("Вещь");

const extraMemory = new Map();
const aliasMemory = new Map();
