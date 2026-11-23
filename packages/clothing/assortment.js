// Ассортимент одежды: какие вещи и места показывать в окне «На что поставить?».
// Вещь определяют сервер, папка и номер; здесь они приводятся к одной форме,
// склеиваются из разных источников и отбираются под запрос окна.
import { garmentFit, garmentKindOf } from "./garment-kinds.js";
import { cleanGameNames, pickGameName, searchableGameNames } from "./game-names.js";
import { COMPONENTS, COMPONENT_NAMES, SERVERS, categoryOfComponent } from "./taxonomy.js";

export const ASSORTMENT_SOURCES = Object.freeze([
  "curated",
  "author",
  "catalog",
  "external",
  "game",
  "files",
  "custom",
]);

// Два порядка надёжности: для файла (суффикс, раса) и для имени.
const NAME_TRUST_ORDER = ["curated", "external", "author", "catalog", "game", "files", "custom"];
const rankTable = (order) => new Map(order.map((source, index) => [source, index]));
const FILE_TRUST = rankTable(ASSORTMENT_SOURCES);
const NAME_TRUST = rankTable(NAME_TRUST_ORDER);
// неизвестный источник даёт NaN (сравнения ложны), пустой список — Infinity
const bestRank = (table, sources) => Math.min(...sources.map((source) => table.get(source)));

const LIMITS = { name: 120, shop: 80, preview: 2048, textures: 26, drawable: 999 };
const ruCollator = new Intl.Collator("ru");

// пробельные подряд — один пробел, края срезаются
const squash = (value) => String(value ?? "").split(/\s+/).filter(Boolean).join(" ");

// Первые вхождения по ключу; seen можно заполнить заранее («уже взято»).
function firstPerKey(list, keyOf = (item) => item.key, seen = new Set()) {
  return list.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- очистка имени, написанного автором мода ----------

const GENDER_TAIL = /\s*·\s*(?:муж|жен)\.?$/i;
const ADDON_CODE = /\s*·\s*(?:patchday\d+ng|patch\d{4}_\d{2}|mp\d{4}_\d{2}|mp_[mf]_\w+)(?=\s*(?:·|$))/gi;
const NOT_A_NAME = [
  /смотри в коммент/i,
  /\d\s*kg\s*[+,]/i,
  /для\s*5\s*рп/i,
  /все рюкзаки/i,
  /\/\s*\d+\s*кг\s*:/i,
  /\b(?:killa|cs2)\b/i,
];
const NOT_A_BAG_NAME = /джинс|штан|брюк/i;

// Подпись вида впереди: «Верх · Куртка» -> «Куртка». У записей из прототипа
// объекта подписи нет, и обращение к её длине бросает — это часть контракта.
function dropKindLabel(text, component) {
  const entry = COMPONENTS[component];
  if (!entry) return text;
  const cut = entry.label.length + 3;
  return text.startsWith(`${entry.label} · `) && text.length > cut ? text.slice(cut) : text;
}

function unwrapBrackets(text) {
  const match = /^\((.+)\)$/.exec(text);
  return match ? match[1] : text;
}

function rejectNonNames(text, component) {
  if (NOT_A_NAME.some((pattern) => pattern.test(text))) return "";
  return component === "hand" && NOT_A_BAG_NAME.test(text) ? "" : text;
}

const NAME_STEPS = [
  (text) => text.replace(GENDER_TAIL, ""),
  (text) => text.replace(ADDON_CODE, ""),
  dropKindLabel,
  unwrapBrackets,
  rejectNonNames,
];

export function cleanItemName(value, component = "") {
  const cleaned = NAME_STEPS.reduce((text, step) => step(text, component), squash(value));
  return cleaned.trim();
}

// ---------- папка персонажа, ключ, место, слот ----------

const COLLECTION_TEXT = /^[a-z0-9_]{1,64}$/;

// mp_{m|f}_freemode_01[_p][_коллекция]; «_p» — признак пропов, только если за ним
// конец или «_» и допустимая коллекция, иначе «p…» уже часть коллекции.
function parseCharacterFolder(text) {
  const head = /^mp_([mf])_freemode_01/.exec(text);
  if (!head) return null;
  const gender = head[1] === "f" ? "female" : "male";
  const tail = text.slice(head[0].length);
  if (tail === "") return { gender, prop: false, collection: null };
  if (!tail.startsWith("_")) return null;
  const rest = tail.slice(1);
  if (rest === "p") return { gender, prop: true, collection: null };
  if (rest.startsWith("p_") && COLLECTION_TEXT.test(rest.slice(2))) {
    return { gender, prop: true, collection: rest.slice(2) };
  }
  return COLLECTION_TEXT.test(rest) ? { gender, prop: false, collection: rest } : null;
}

export function assortmentKey({ server, folder, drawable }) {
  return `${server || "*"}|${folder}|${drawable}`;
}

export function assortmentPlace({ folder, drawable }) {
  return `${folder}|${drawable}`;
}

export function assortmentSlot({ folder, component, drawable }) {
  const parsed = parseCharacterFolder(String(folder ?? "").toLowerCase());
  if (!parsed) return null;
  const scope = parsed.collection ? `${parsed.collection}-` : "";
  return `clothing-${parsed.gender}-${scope}${component}-${String(drawable).padStart(3, "0")}`;
}

// ---------- вещь из сырой записи ----------

const SLEEVES = ["none", "short", "long"];
const isSlotNumber = (value) => Number.isInteger(value) && value >= 0 && value <= LIMITS.drawable;

function shopOf(value) {
  const text = squash(value).slice(0, LIMITS.shop);
  const hasContent = /[\p{L}\p{N}]/u.test(text);
  const isBagWeight = /^\d+(?:[.,]\d+)?\s*(?:кг|kg)$/i.test(text);
  const isVariant = /вариант|варик/i.test(text);
  return hasContent && !isBagWeight && !isVariant ? text : null;
}

function previewOf(value) {
  return String(value ?? "").trim().slice(0, LIMITS.preview) || null;
}

// Необязательные поля идут строго в порядке shape, glove, look, hidden.
function optionalFields(input) {
  const extra = {};
  const sleeve = input.shape?.sleeve;
  if (SLEEVES.includes(sleeve)) extra.shape = { sleeve, hood: input.shape.hood === true };

  const glove = input.glove;
  if ([glove?.start, glove?.size, glove?.index].every(isSlotNumber)) {
    extra.glove = Object.freeze({ start: glove.start, size: glove.size, index: glove.index });
  }

  const lookId = String(input.look ?? "");
  if (/^\d{1,6}$/.test(lookId)) {
    extra.look = Object.freeze({
      id: lookId,
      rep: input.lookRep === true,
      forms: input.lookForms === true,
    });
  }
  if (input.hidden === true) extra.hidden = true;
  /* Номера расцветок-заглушек игры по размеру файла (`colour-files.js`): окно не рисует их плитки и не считает их в значке и в числе вещей (владелец, 22.11.2026: «Прятать»). */
  if (Array.isArray(input.colourStubs)) {
    const stubs = [...new Set(input.colourStubs.filter((index) => Number.isInteger(index) && index >= 0 && index < LIMITS.textures))].sort((left, right) => left - right);
    if (stubs.length) extra.colourStubs = Object.freeze(stubs);
  }
  return extra;
}

export function assortmentItem(input, source = "catalog") {
  const folder = String(input?.folder ?? "").toLowerCase();
  const parsed = parseCharacterFolder(folder);
  if (!parsed) return null;

  const drawable = Number(input.drawable);
  if (!isSlotNumber(drawable)) return null;

  const component = String(input.component ?? "").toLowerCase();
  if (!COMPONENT_NAMES.includes(component)) return null;
  if (COMPONENTS[component].prop !== parsed.prop) return null;

  const server = SERVERS.some(({ id }) => id === input.server) ? input.server : null;
  /* Строки игры по языкам (ru, en, de, fr, pl) — только у вещи игры: окно показывает название на языке интерфейса (`shownItemName`), а `name` остаётся русским. */
  const names = cleanGameNames(input.names);
  const item = {
    server,
    gender: parsed.gender,
    component,
    prop: parsed.prop,
    category: categoryOfComponent(component)?.id ?? null,
    folder,
    collection: parsed.collection,
    drawable,
    modelSuffix: input.modelSuffix === "u" || input.modelSuffix === "r" ? input.modelSuffix : null,
    race: /^[a-z]{3}$/.test(input.race) ? input.race : null,
    textures: Math.min(LIMITS.textures, Math.max(1, Number(input.textures) || 1)),
    name: cleanItemName(input.name, component).slice(0, LIMITS.name) || null,
    ...(names ? { names } : {}),
    shop: shopOf(input.shop),
    preview: previewOf(input.preview),
    sources: ASSORTMENT_SOURCES.includes(source) ? [source] : ["catalog"],
    mods: Math.max(0, Number(input.mods) || 0),
    ...optionalFields(input),
  };
  item.key = assortmentKey(item);
  return item;
}

// ---------- склейка одной вещи из нескольких источников ----------

// «Перечень»: автор назвал сразу несколько вещей.
const isRoster = (name) => / [|/] |\d\s*кг\s*:/i.test(name ?? "");

// Добавка переименовывает основу, если имя у неё есть и либо у основы имени нет,
// либо добавка надёжнее; слабая добавка (вещь игры) вытесняет только перечень.
function renames(base, add, weak) {
  if (!add.name) return false;
  if (!base.name) return true;
  const baseRoster = isRoster(base.name);
  const better =
    baseRoster !== isRoster(add.name)
      ? baseRoster
      : bestRank(NAME_TRUST, add.sources) < bestRank(NAME_TRUST, base.sources);
  return better && (!weak || baseRoster);
}

// Метка «оставить как было» для таблицы правил слияния.
const KEEP = Symbol("keep");
const preferTrusted = (field) => (base, add, ctx) =>
  add[field] && (!base[field] || ctx.trusted) ? add[field] : KEEP;
const raiseFlag = (field) => (base, add) => (add[field] ? true : KEEP);
const fillIfMissing = (field) => (base, add) => (!base[field] && add[field] ? add[field] : KEEP);
const union = (...lists) => [...new Set(lists.flatMap((list) => [...list]))];

// Поле -> как вливать добавку в основу. Порядок строк важен: картинка читает
// preview основы до того, как правило preview её заменит.
const FIELD_MERGERS = [
  ["name", (base, add, ctx) => (ctx.renames ? add.name : KEEP)],
  ["doubt", (base, add, ctx) => (ctx.renames ? Boolean(add.doubt) : KEEP)],
  /* Запасное имя базы серверов (`fallbackName`, `server-base-format.js`): имя заменили — признак уходит вместе с ним; вещам без признака поле не добавляется. */
  ["fallbackName", (base, add, ctx) => (ctx.renames && base.fallbackName ? add.fallbackName === true : KEEP)],
  ["shop", (base, add, ctx) => (add.shop && (!base.shop || ctx.renames) ? add.shop : KEEP)],
  ["modelSuffix", preferTrusted("modelSuffix")],
  ["race", preferTrusted("race")],
  ["pictureKind", (base, add) => (!base.preview && add.preview ? (add.pictureKind ?? null) : KEEP)],
  ["preview", (base, add) => (base.preview ? KEEP : add.preview)],
  ["textures", (base, add) => Math.max(base.textures, add.textures)],
  ["mods", (base, add) => base.mods + add.mods],
  ["aliases", (base, add) => (add.aliases?.length > 0 ? union(base.aliases ?? [], [...add.aliases]) : KEEP)],
  ["computed", raiseFlag("computed")],
  ["byGame", raiseFlag("byGame")],
  ["shape", fillIfMissing("shape")],
  ["glove", fillIfMissing("glove")],
  ["pictureSha", fillIfMissing("pictureSha")],
  ["look", fillIfMissing("look")],
  ["hidden", raiseFlag("hidden")],
  ["colourStubs", fillIfMissing("colourStubs")],
  ["sources", (base, add) => union(base.sources, add.sources)],
];

function absorb(base, add, weak) {
  const ctx = {
    renames: renames(base, add, weak),
    // суффикс и раса доверяются только не слабой и более надёжной по файлу добавке
    trusted: !weak && bestRank(FILE_TRUST, add.sources) < bestRank(FILE_TRUST, base.sources),
  };
  for (const [field, merge] of FIELD_MERGERS) {
    const next = merge(base, add, ctx);
    if (next !== KEEP) base[field] = next;
  }
  /* Строки игры по языкам идут за именем: имя заменили — строки старого имени уходят, а у нового они свои (или их нет, имя не игры). */
  if (ctx.renames) {
    if (add.names) base.names = add.names;
    else delete base.names;
  }
}

const copyOf = (entry) => ({ ...entry, sources: [...entry.sources] });

export function mergeAssortment(...lists) {
  const entries = lists.flatMap((list) => [...(list || [])]).filter((entry) => entry?.key);
  const merged = entries.reduce((byKey, entry) => {
    const base = byKey.get(entry.key);
    if (base) absorb(base, entry, false);
    else byKey.set(entry.key, copyOf(entry));
    return byKey;
  }, new Map());
  return [...merged.values()];
}

function itemsOfBlock(block) {
  if (!block?.component) return [];
  const made = [...(block.replaces ?? [])].map((target) =>
    assortmentItem({ ...target, component: block.component, mods: 1 }, "catalog"),
  );
  return firstPerKey(made.filter(Boolean));
}

export function catalogAssortment(blocks = []) {
  return mergeAssortment([...blocks].flatMap(itemsOfBlock));
}

// ---------- выбор вещей для окна ----------

// Вещь сервера вытесняет вещь игры на том же месте, а та вливается слабой добавкой.
function settle(held, incoming) {
  if (!held) return incoming;
  if (incoming.server && !held.server) {
    absorb(incoming, held, true);
    return incoming;
  }
  absorb(held, incoming, !incoming.server && Boolean(held.server));
  return held;
}

export function assortmentFor(items, { server = null, gender, component }) {
  // неуказанный пол — список из одного undefined
  const genders = Array.isArray(gender) ? gender : [gender];
  const wanted = (item) =>
    genders.includes(item.gender) && item.component === component && (!item.server || item.server === server);

  const byPlace = [...items]
    .filter(wanted)
    .map(copyOf)
    .reduce((placed, item) => {
      const place = assortmentPlace(item);
      return placed.set(place, settle(placed.get(place), item));
    }, new Map());
  return [...byPlace.values()];
}

export function assortmentKind(item) {
  const titles = [...(item?.aliases ?? [])];
  titles.unshift(item?.name);
  return garmentKindOf({ component: item?.component, names: titles });
}

export function splitByFit(items, { component, kind }) {
  const list = [...items];
  const verdicts = list.map((item) => garmentFit(component, kind, assortmentKind(item)));
  const pick = (test) => list.filter((_, index) => test(verdicts[index]));
  return {
    fit: pick((verdict) => verdict === "yes"),
    unknown: pick((verdict) => verdict !== "yes" && verdict !== "no"),
    other: pick((verdict) => verdict === "no"),
  };
}

// ---------- советы ----------

const foldName = (name) => String(name ?? "").toLowerCase().replaceAll("ё", "е");

// Плитка (look + together) отвечает за все места своих вещей.
const tileMembers = (item) => (item.look && item.together ? item.together : null);

// место -> вещь; если место называют несколько вещей, берётся первая в списке
function indexByPlace(items) {
  const claims = [...items].flatMap((item) =>
    [assortmentPlace(item), ...(tileMembers(item) ?? []).map(assortmentPlace)].map((place) => [place, item]),
  );
  return new Map(claims.reverse());
}

// Названия автора группируют советы: «сервер цели | пол вещи | название».
function groupAuthorAdvice(author, index) {
  const groups = new Map();
  for (const target of [...author]) {
    const hit = index.get(assortmentPlace(target));
    if (!hit) continue;
    const groupKey = `${target.server}|${hit.gender}|${foldName(target.name)}`;
    const group = groups.get(groupKey) ?? { name: target.name, hits: [] };
    group.hits.push(hit);
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}

const withReason = (reason) => (item) => ({ ...item, key: item.key, reason });

// Запись совета по группе: одна вещь — обычная; несколько — одна запись «вместе»,
// но только если ни одна из вещей ещё не взята.
function adviceFor({ name, hits }, taken) {
  const distinct = firstPerKey(hits);
  const members = distinct.length > 1 ? firstPerKey(distinct.flatMap((item) => tileMembers(item) ?? [item])) : distinct;

  if (members.length >= 2) {
    if (members.some((member) => taken.has(member.key))) return null;
    const record = { ...members[0], key: `together|${members[0].key}`, reason: "author", together: members };
    if (name) record.name = name;
    members.forEach((member) => taken.add(member.key));
    taken.add(record.key);
    return record;
  }
  const only = members[0] ?? distinct[0];
  if (taken.has(only.key)) return null;
  taken.add(only.key);
  return withReason("author")(only);
}

function authorAdvice(author, index) {
  const taken = new Set();
  const records = groupAuthorAdvice(author, index)
    .map((group) => adviceFor(group, taken))
    .filter(Boolean);
  return { records, taken };
}

// Проданные вещи: больше модов, затем магазин по алфавиту (ru), затем номер.
function soldRanking(items, server) {
  return items
    .filter((item) => item.shop && item.server && (!server || item.server === server))
    .filter((item) => item.mods > 0 || item.sources.includes("catalog"))
    .sort((a, b) => b.mods - a.mods || ruCollator.compare(a.shop, b.shop) || a.drawable - b.drawable);
}

export function recommendedOf(items, { author = [], server = null, limit = 8 } = {}) {
  const { records, taken } = authorAdvice(author, indexByPlace(items));
  const curated = items.filter((item) => item.sources.includes("curated")).map(withReason("curated"));
  const sold = soldRanking(items, server).map(withReason("sold"));
  const rest = firstPerKey([...curated, ...sold], (record) => record.key, taken);
  return [...records, ...rest].slice(0, limit);
}

// ---------- имя, цель установки, поиск, полки, своя вещь ----------

// «Верх · Binco», «Верх №33 · pack3» или «Верх №33 из игры»
function nameTail(item, translate = (text) => text) {
  /* Полка вещи игры («Ограбление казино») — слово игроков, переведено в словаре окна; магазин сервера («Binco») там не найдётся и останется как есть. */
  if (item?.shop) return ` · ${translate(item.shop)}`;
  if (item?.collection) return ` №${item.drawable} · ${item.collection}`;
  return ` №${item?.drawable} ${translate("из игры")}`;
}

/**
 * Название вещи на языке окна. У вещи игры (`names`) — строка игры на этом языке по цепочке языка (`game-names.js`; у украинского игры нет — английская); нет строки — пусто, и окно ставит
 * запасное название. У вещи сервера, автора и каталога строк игры нет — её имя на любом языке.
 */
export function shownItemName(item, language) {
  if (item?.names) return pickGameName(item.names, language);
  return item?.name || "";
}

/**
 * Имя вещи для окна. `language` — язык окна: вещь игры называется так, как её называет игра на этом языке; без языка — прежнее (русское) имя. Нет названия — слово вида (`translate`) и
 * магазин, коллекция или номер.
 */
export function itemName(item, translate = (text) => text, language = null) {
  const describe = () => translate(COMPONENTS[item?.component]?.label || "Вещь") + nameTail(item, translate);
  return (language ? shownItemName(item, language) : item?.name) || describe();
}

const INSTALL_TARGET_FIELDS = ["shop", "server", "folder", "component", "drawable", "modelSuffix", "race", "textures"];

/*
 * Цель установки по вещи. У вещи игры к цели идут названия на языках игры (`names`) и коллекция (для запасного названия по типу и номеру): окно называет цель на языке интерфейса тем же `itemName`, что и список (17.11.2026),
 * а запись установки хранит названия для «Библиотеки». `name` — русское, как было. У вещи без строк игры (сервер, автор, каталог) этих полей нет.
 */
export function assortmentInstallTarget(item) {
  const fields = INSTALL_TARGET_FIELDS.map((field) => [field, item[field]]);
  const names = cleanGameNames(item?.names);
  const own = names ? [["names", { ...names }], ["collection", item.collection]] : [];
  return Object.fromEntries([["name", itemName(item)], ...fields, ...own]);
}

const fold = (text) => String(text).toLocaleLowerCase("ru").replaceAll("ё", "е");
const NUMBER_WORD = /^\d{1,4}$/;
const FILE_WORD = /^([a-z_]+)_(\d{1,4})$/;

function haystackOf(item) {
  const parts = [itemName(item), ...searchableGameNames(item.names), item.shop, item.collection, item.component, ...(item.aliases ?? [])];
  return fold(parts.filter(Boolean).join(" "));
}

function wordMatches(item, word, textOf) {
  if (NUMBER_WORD.test(word)) return Number(item.drawable) === Number(word);
  const file = FILE_WORD.exec(word);
  if (file && item.component.startsWith(file[1])) return Number(item.drawable) === Number(file[2]);
  return textOf().includes(word);
}

export function searchAssortment(items, query) {
  const words = fold(query || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    let text;
    const textOf = () => (text ??= haystackOf(item));
    return words.every((word) => wordMatches(item, word, textOf));
  });
}

// полки: с магазином раньше безымянной общей, больше вещей раньше, затем по названию
function compareShelves(a, b) {
  if ((a.shop === null) !== (b.shop === null)) return a.shop === null ? 1 : -1;
  return b.items.length - a.items.length || (a.shop === null ? 0 : ruCollator.compare(a.shop, b.shop));
}

const namedFirst = (a, b) => Number(!a.name) - Number(!b.name) || a.drawable - b.drawable;

export function shopGroups(items) {
  const list = [...items];
  const shopOfItem = (item) => item.shop || null;
  return [...new Set(list.map(shopOfItem))]
    .map((shop) => ({ shop, items: list.filter((item) => shopOfItem(item) === shop).sort(namedFirst) }))
    .sort(compareShelves);
}

const FOLDER_PREFIXES = ["mp_m_freemode_01", "mp_f_freemode_01"];
const TAG_CHARS = new Set([..."abcdefghijklmnopqrstuvwxyz0123456789_"]);

// Коллекция из ввода пользователя: без префикса папки, только допустимые знаки.
function collectionTag(raw) {
  // Пустое поле формы — и `0`/`false` из него — коллекции не даёт; пробелы вокруг вставленного имени папки не мешают узнать префикс.
  const text = String(raw || "").trim().toLowerCase();
  const prefix = FOLDER_PREFIXES.find((candidate) => text.startsWith(candidate));
  let rest = prefix ? text.slice(prefix.length) : text;
  // «_p» — папка пропов только целым словом: у «…_pack3» это уже имя коллекции.
  if (prefix && (rest === "_p" || rest.startsWith("_p_"))) rest = rest.slice(2);
  if (prefix && rest.startsWith("_")) rest = rest.slice(1);
  return [...rest].filter((char) => TAG_CHARS.has(char)).join("");
}

export function customAssortmentItem({
  gender,
  component,
  prop = false,
  collection = "",
  drawable,
  textures,
  server = null,
}) {
  const number = String(drawable ?? "").trim();
  if (!number || !Number.isInteger(Number(number))) return null;

  const folderParts = [FOLDER_PREFIXES[gender === "female" ? 1 : 0]];
  if (prop) folderParts.push("p");
  const tag = collectionTag(collection);
  if (tag) folderParts.push(tag);
  return assortmentItem(
    { server, folder: folderParts.join("_"), drawable: Number(number), component, textures },
    "custom",
  );
}
