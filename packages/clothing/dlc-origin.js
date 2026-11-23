/*
 * Вещь из DLC: новая она или замена — и чего именно, какого она типа
 * (задача 5 ТЗ 08.10, вечер).
 *
 * Одежда приходит в каналы тремя видами, и по пути их не спутать:
 *
 *   • замена вещи игры — файл в базовой папке персонажа
 *     (`mp_m_freemode_01/jbib_005_u.ydd`) или в коллекции DLC Rockstar
 *     (`mpheist4/dlc.rpf/…/mp_m_freemode_01_mp_m_heist4/jbib_012_u.ydd`);
 *   • замена вещи сервера или чужого мода — коллекция, которую архив сам не
 *     объявляет (`mp_m_freemode_01_mp_m_clothes_pack3` — вещь Majestic);
 *   • новая вещь — коллекция, которую архив регистрирует сам: свой `.ymt`
 *     коллекции, магазин `ShopPedApparel` (`*_shop.meta`) или пак DLC не
 *     Rockstar, объявивший магазин в `content.xml`.
 *
 * Новой вещи в игре нет: RP-серверы (Majestic, GTA 5 RP, Россия Онлайн)
 * своих вещей не добавляют, Astral Clothing DLC их коллекций не знает. Её
 * ставят вместо вещи, которую выберет человек («На что поставить?»).
 *
 * Тип вещи (худи, футболка, штаны, кроссовки) — по названиям: подпись
 * магазина пака (`textLabel` → `global.gxt2`), имена папок и файлов вещи,
 * затем название поста и канал, если они называют один тип; иначе — по
 * форме модели (`garmentShape`: рукава, капюшон).
 */

import {
  dlcTitle,
  isRockstarPack,
  packOfPath,
} from "@modovik/pack-intake/dlc-packs";
import {
  GARMENT_WORDS,
  garmentKindLabel,
  garmentKindsOf,
} from "./garment-kinds.js";
import { garmentShape } from "./garment-shape.js";
import { parseGxt2 } from "./gxt2.js";
import { rockstarDlc, stockDlcOf } from "./items.js";
import { parseShopMeta } from "./shop-meta.js";
import { COMPONENTS } from "./taxonomy.js";

/* Магазин одежды: `mp_m_freemode_01_<коллекция>_shop.meta` в паке игры,
   `mp_m_freemode_01_<коллекция>.meta` у FiveM — XML `ShopPedApparel`. */
export const SHOP_META_PATH =
  /(?:^|\/)(?:[^/]*shop[^/]*|mp_[mf]_freemode_01[^/]*)\.meta$/i;
export const GXT2_PATH = /\.gxt2$/i;

/* Язык подписей: русский, а чего в нём нет — английский, потом любой. */
const LANGUAGE_ORDER = [/russian/i, /american|english/i];

async function readBytes(file) {
  const bytes = await file.read();
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/**
 * Подписи вещей архива: магазины `ShopPedApparel` и таблицы языка.
 * Возвращает `{ shops, nameOf(folder, component, drawable) }` — имя вещи
 * словами или `""`.
 */
export async function readShopNames(files = []) {
  const shops = [];
  const tables = [];
  for (const file of files) {
    const path = String(file.path || "");
    try {
      if (SHOP_META_PATH.test(path)) {
        const shop = parseShopMeta(new TextDecoder().decode(await readBytes(file)));
        if (shop) shops.push({ ...shop, path });
      } else if (GXT2_PATH.test(path) && tables.length < 8) {
        const table = parseGxt2(await readBytes(file));
        if (table.size) tables.push({ path, table });
      }
    } catch {
      /* битый магазин или таблица языка — вещь остаётся без подписи */
    }
  }
  const rank = (path) => {
    const at = LANGUAGE_ORDER.findIndex((pattern) => pattern.test(path));
    return at < 0 ? LANGUAGE_ORDER.length : at;
  };
  tables.sort((left, right) => rank(left.path) - rank(right.path));
  const text = (label) => {
    for (const { table } of tables) {
      const value = label ? table.get(label) : "";
      if (value) return value;
    }
    return "";
  };
  /* Вещь — по папке коллекции, компоненту и номеру; подпись — первой
     расцветки (у остальных — тот же ярлык с другим номером цвета). */
  const labels = new Map();
  for (const shop of shops) {
    const props = shop.folder.replace(/^(mp_[mf]_freemode_01)_/i, "$1_p_");
    for (const item of shop.items) {
      const folder = item.prop ? props : shop.folder;
      const key = `${folder}|${item.component}|${item.drawable}`;
      if (labels.has(key) && item.texture !== 0) continue;
      labels.set(key, item.label);
    }
  }
  return {
    shops,
    nameOf(folder, component, drawable) {
      return text(
        labels.get(
          `${String(folder || "").toLowerCase()}|${component}|${drawable}`,
        ),
      );
    },
  };
}

/**
 * Коллекции, которые архив объявляет сам: `.ymt` коллекции (`meta` из
 * `groupClothingItems`) и магазины. Ключ — `<пол>|<коллекция>`: пропы
 * (`…_p_<коллекция>`) — та же коллекция.
 */
export function registeredCollections({ meta = [], shops = [] } = {}) {
  const out = new Set();
  for (const entry of meta)
    if (entry?.collection && entry.gender)
      out.add(`${entry.gender}|${String(entry.collection).toLowerCase()}`);
  for (const shop of shops) {
    const collection = /^mp_[mf]_freemode_01_(.+)$/i.exec(shop.folder)?.[1];
    if (collection && shop.gender)
      out.add(`${shop.gender}|${collection.toLowerCase()}`);
  }
  return out;
}

/*
 * У пропов коллекция в пути — `p_<коллекция>` только у FiveM-копий без `_p`:
 * `pedFolderOf` уже снимает `_p`, здесь — на всякий случай.
 */
const collectionKey = (item) =>
  `${item.gender || "male"}|${String(item.collection || "")
    .toLowerCase()
    .replace(/^p_/, "")}`;

/**
 * Происхождение вещи: `{ origin: "addon" | "replace", source, dlc, title,
 * collection, pack }`.
 *
 *   source `game`      — базовая одежда игры (папка без коллекции);
 *          `rockstar`  — вещь DLC Rockstar (`dlc` — имя, `title` — для людей);
 *          `collection`— коллекция, которую архив не объявляет (сервер,
 *                        чужой мод);
 *          `dlc`       — своя коллекция архива: новая вещь.
 */
export function itemOrigin(item, { packs = [], registered = new Set() } = {}) {
  const path =
    item.models?.[0]?.path ||
    item.sets?.[0]?.textures?.[0]?.path ||
    item.sets?.[0]?.model?.path ||
    "";
  const pack = packOfPath(packs, path);
  const collection = item.collection
    ? String(item.collection).toLowerCase()
    : null;
  const base = { collection, pack: pack?.name || null };
  if (!collection) return { ...base, origin: "replace", source: "game" };
  const stock = item.models?.[0]
    ? stockDlcOf(item.models[0].container, item.folder)
    : null;
  if (stock && rockstarDlc(stock) && stock !== "стрим игры")
    return {
      ...base,
      origin: "replace",
      source: "rockstar",
      dlc: stock,
      title: dlcTitle(stock),
    };
  if (pack && isRockstarPack(pack.name))
    return {
      ...base,
      origin: "replace",
      source: "rockstar",
      dlc: pack.name,
      title: dlcTitle(pack.name),
    };
  if (registered.has(collectionKey(item)))
    return {
      ...base,
      origin: "addon",
      source: "dlc",
      dlc: pack?.name || collection,
      title: pack?.name || collection,
    };
  return { ...base, origin: "replace", source: "collection" };
}

const placeLabel = (item) =>
  `${COMPONENTS[item.component]?.label || "Вещь"} №${item.drawable}`;

/**
 * Что вещь заменяет — словами для описания карточки:
 * «Заменяет «Верх №5» из базовой одежды игры.»
 */
export function originSentence(origin, item, { stockName = "" } = {}) {
  const place = stockName ? `«${stockName}» (${placeLabel(item)})` : `«${placeLabel(item)}»`;
  switch (origin?.source) {
    case "game":
      return `Заменяет ${place} из базовой одежды игры.`;
    case "rockstar":
      return `Заменяет ${place} из DLC «${origin.title}» (${origin.dlc}).`;
    case "collection":
      return `Заменяет ${place} коллекции ${origin.collection} (вещь сервера или другого мода).`;
    case "dlc":
      if (origin.project)
        return `Вещь проекта ${origin.project} (пак ${origin.dlc}, коллекция ${origin.collection}): при установке выберите, вместо какой вещи она встанет («На что поставить?»).`;
      return `Новая вещь DLC «${origin.title}» (коллекция ${origin.collection}): в игре и на серверах её нет — при установке выберите, вместо какой вещи она встанет («На что поставить?»).`;
    default:
      return "";
  }
}

/* Слова типа, которые встречаются в тексте: все типы компонента, чьё
   правило совпало, — чтобы общее название поста «Футболка и куртка» не
   назначило обеим вещам один тип. */
function kindsNamed(component, names) {
  const text = names
    .filter(Boolean)
    .map((name) => String(name).toLowerCase().replace(/ё/g, "е"))
    .join(" | ");
  if (!text.trim()) return [];
  return garmentKindsOf(component)
    .map((kind) => kind.id)
    .filter((id) => {
      const rule = KIND_RULES.get(`${component}|${id}`);
      return rule ? rule.test(text) : false;
    });
}

/* Правила `garment-kinds.js` по одному: первое совпадение там решает, а
   здесь нужно знать все совпавшие. Порядок у `garmentKindOf` тот же. */
const KIND_RULES = new Map(
  Object.entries(GARMENT_WORDS).flatMap(([component, rules]) =>
    rules.map(([id, pattern]) => [`${component}|${id}`, pattern]),
  ),
);

/** Первый тип по правилам компонента (порядок `garment-kinds.js`). */
function firstKind(component, names) {
  const found = new Set(kindsNamed(component, names));
  return (GARMENT_WORDS[component] || []).map(([id]) => id).find((id) => found.has(id)) || null;
}

/*
 * Тип по форме модели. Верх: капюшон — худи, рукав — майка, футболка,
 * лонгслив. Обувь: голенище выше −0,78 м — ботинки (замер 08.10 по обуви
 * игры: верх сапог и ботинок −0,61…−0,80, кроссовок, кед и лоферов не выше
 * −0,80; ниже — не различить: ботинок под штаниной и кроссовка одного
 * роста). Низ по форме не узнать: у шорт в модели голые ноги до щиколотки,
 * низ у шорт и штанов один (−0,97 м).
 */
const BOOTS_TOP = -0.78;
function kindOfShape(component, shape) {
  if (!shape || shape.placeholder) return null;
  if (component === "feet")
    return Number.isFinite(shape.top) && shape.top > BOOTS_TOP ? "boots" : null;
  if (!shape.sleeve) return null;
  if (shape.hood) return "hoodie";
  return { none: "tank", short: "tshirt", long: "longsleeve" }[shape.sleeve] || null;
}

/**
 * Тип вещи: `{ id, label, from: "name" | "post" | "shape" }` или `null`
 * (у компонента типов нет — маска, сумка, шапка — или ничто его не назвало).
 *
 * `own` — имена самой вещи (подпись магазина, папки и файлы), `post` —
 * общие для архива (название поста, имя архива, канал): по ним тип берётся,
 * только если они называют ровно один тип этого компонента.
 */
export function garmentOf({ component, own = [], post = [], drawable = null }) {
  if (!garmentKindsOf(component).length) return null;
  const mine = firstKind(component, own);
  if (mine) return { id: mine, label: garmentKindLabel(mine), from: "name" };
  const shared = kindsNamed(component, post);
  if (shared.length === 1)
    return { id: shared[0], label: garmentKindLabel(shared[0]), from: "post" };
  const shaped = drawable
    ? kindOfShape(component, garmentShape(drawable, component))
    : null;
  if (shaped) return { id: shaped, label: garmentKindLabel(shaped), from: "shape" };
  return null;
}

/* Служебные папки — не имя вещи. */
const SERVICE_FOLDER =
  /^(?:x64|models?|cdimages|stream|textures?|ydd|ytd|dlc|update|mods?|common|data|files?|male|female|men|women|m|f|муж\p{L}*|жен\p{L}*)$/iu;

/**
 * Имена самой вещи из её пути: папки между архивом и паком/папкой
 * персонажа («Pack.zip/Nike Hoodie/Model/jbib_000_u.ydd» → «Nike Hoodie»).
 * Имя архива и пака — общие для всех вещей, они идут в имена поста.
 */
export function ownNamesOf(item, { packs = [] } = {}) {
  const names = [];
  for (const model of item.models || []) {
    const segments = String(model.path || "").split("/");
    /* Первый сегмент — архив поста (`Pack.zip`) или корень папки; у вещи
       пака DLC — всё до корня пака включительно (имя пака общее). */
    const pack = packOfPath(packs, model.path);
    const from = pack?.root ? pack.root.split("/").length : 1;
    for (const segment of segments.slice(from, -1)) {
      if (
        /\.rpf$/i.test(segment) ||
        /^dlcpacks$/i.test(segment) ||
        /^mp_[mf]_freemode_01/i.test(segment)
      )
        break;
      if (/\.(?:7z|zip|rar|oiv)$/i.test(segment) || SERVICE_FOLDER.test(segment))
        continue;
      names.push(segment.replace(/[_-]+/g, " ").trim());
    }
  }
  return [...new Set(names.filter(Boolean))];
}
