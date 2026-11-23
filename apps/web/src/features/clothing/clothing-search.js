/*
 * Поиск и группы «На что поставить?» (задача 9 ТЗ 10.10.2026, вечер).
 *
 * Владелец: «человек в поиске вводил бы название, и одежда предлагала бы
 * сразу все варианты; он мог бы раскрывать ещё, и прогружалось бы по 15».
 * Поэтому ответ поиска — группы: вещи выбранного проекта, вещи самой игры
 * (они есть на любом сервере) и вещи других проектов; без запроса — полки
 * магазинов (у вещей без магазина — пак сервера или дополнение игры).
 * Сколько строк показать и что раскрыто — решает окно, по 15 за раз.
 *
 * Ищется по названию, магазину, именам цветов, папке и файлу
 * (`skins5`, `clothes_pack3`, `jbib_072`, `jbib_072_u.ydd`); число — номер
 * файла или номер вещи на сервере. Текст складывается как в поиске каталога
 * (`features/catalog/search-text.js`: строчные, «ё» = «е»), а запрос,
 * который ничего не нашёл, перекладывается на другую раскладку.
 *
 * Вещей одного вида у трёх серверов и игры — до трёх-четырёх тысяч: текст
 * вещи складывается один раз (кэш по ключу и имени), поиск — проход по
 * строкам, 1–3 мс на букву.
 */

import { itemName } from "@modovik/clothing/assortment";
import { isBeardItem } from "@modovik/clothing/beard";
import { BASE_SHOP } from "@modovik/clothing/game-assortment";
import { searchableGameNames } from "@modovik/clothing/game-names";
import { COMPONENTS, serverById } from "@modovik/clothing/taxonomy";
import { tabById } from "@modovik/clothing/target-tabs";
import { foldSearchText, swapKeyboardLayout } from "../catalog/search-text.js";
import { tr } from "../../locales/ui.js";
import { shownShop } from "./item-title.js";

/* Сколько строк группы показывать за раз (задача 9: «по 15 штучек»). */
export const GROUP_PAGE = 15;

const pad = (value) => String(value).padStart(3, "0");
const texts = new Map();
const TEXT_LIMIT = 40_000;

/** Текст вещи для сравнения: имя, магазин, цвета, папка, файл, вид. */
export function itemSearchText(item) {
  const id = `${item.key}|${item.name || ""}|${item.names ? 1 : 0}|${item.shop || ""}|${item.aliases?.length || 0}`;
  let text = texts.get(id);
  if (text === undefined) {
    const file = `${item.component}_${pad(item.drawable)}`;
    text = foldSearchText(
      [
        itemName(item),
        /* Вещь игры находят по названию на любом из языков игры (`names`), а не только на языке окна. */
        ...searchableGameNames(item.names),
        item.shop,
        ...(item.aliases || []),
        item.folder,
        file,
        item.modelSuffix ? `${file}_${item.modelSuffix}.ydd` : `${file}.ydd`,
        `${item.component}_diff_${pad(item.drawable)}`,
        COMPONENTS[item.component]?.label,
      ]
        .filter(Boolean)
        .join(" | "),
    );
    if (texts.size > TEXT_LIMIT) texts.clear();
    texts.set(id, text);
  }
  return text;
}

const NUMBER = /^№?(\d{1,4})$/;
/* Файл вещи в любом виде: `jbib_072`, `jbib_072_u.ydd`, `jbib_diff_072_a_uni.ytd`. */
const FILE =
  /^(p_[a-z]+|[a-z]{3,5})(?:_diff)?_(\d{1,3})(?:_[a-z])?(?:_[a-z]{3})?(?:_[ur])?(?:\.(?:ydd|ytd))?$/;

function tokenFits(item, text, token) {
  const number = NUMBER.exec(token);
  if (number) {
    const value = Number(number[1]);
    return item.drawable === value || item.global === value;
  }
  const file = FILE.exec(token);
  if (file && COMPONENTS[file[1]])
    return item.component === file[1] && item.drawable === Number(file[2]);
  return text.includes(token);
}

/* Имена — по-русски и с числами по значению: «№2» раньше «№10». */
/* Объекты `Intl` — при первом обращении, а не при загрузке модуля (30.10.2026, главный модуль): первый из них поднимает данные ICU (~12 мс при ×4 в задаче главного модуля), и платит за это тот, кто загружается первым. */
let nameCollator = null;
const byName = { compare: (left, right) => (nameCollator ||= new Intl.Collator("ru", { numeric: true })).compare(left, right) };

/*
 * Порядок найденного: имя начинается с запроса, имя его содержит, нашлось
 * по магазину, папке или файлу, вещь без имени; дальше — по имени и номеру.
 */
function rank(item, phrase) {
  const name = item.name ? foldSearchText(item.name) : "";
  if (!name) return 3;
  if (name.startsWith(phrase)) return 0;
  return name.includes(phrase) ? 1 : 2;
}

/** Вещи списка, подходящие под запрос, — по порядку найденного. */
export function searchTargetItems(items, query) {
  const phrase = foldSearchText(query);
  const tokens = phrase.split(" ").filter(Boolean);
  if (!tokens.length) return items;
  const found = [];
  for (const item of items) {
    const text = itemSearchText(item);
    if (tokens.every((token) => tokenFits(item, text, token)))
      found.push({ item, rank: rank(item, phrase) });
  }
  return found
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        byName.compare(String(left.item.name || ""), String(right.item.name || "")) ||
        left.item.drawable - right.item.drawable,
    )
    .map((entry) => entry.item);
}

/*
 * Группы ответа поиска: проект → вещи игры → другие проекты. `others` —
 * `[{ server, items }]`: их вещи выбираются переходом на их проект. Ничего
 * не нашлось — запрос перекладывается на другую раскладку
 * (`swapped` — по чему нашлось).
 */
export function searchTargetGroups({ items, others = [], server, query }) {
  const run = (text) => {
    const own = [];
    const game = [];
    for (const item of searchTargetItems(items, text))
      (item.server ? own : game).push(item);
    const label = tabById(server)?.label || serverById(server)?.label || tr("сервера");
    return [
      { key: `own:${server}`, title: `${label} — вещи сервера`, server, items: own },
      { key: "game", title: tr("Вещи игры GTA V"), server: null, items: game },
      ...others.map((entry) => ({
        key: `other:${entry.server}`,
        title: `${serverById(entry.server)?.label || entry.server} — другой проект`,
        server: entry.server,
        other: true,
        items: searchTargetItems(entry.items, text),
      })),
    ].filter((group) => group.items.length);
  };
  let groups = run(query);
  let swapped = null;
  if (!groups.length) {
    const retry = swapKeyboardLayout(query);
    const again = retry ? run(retry) : [];
    if (again.length) {
      groups = again;
      swapped = retry;
    }
  }
  return {
    groups: groups.map((group) => ({ ...group, open: true })),
    swapped,
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
  };
}

/* Полка вещи без магазина: пак сервера, дополнение игры или база игры. */
const packOf = (item) =>
  item.collection
    ? `Пак ${item.collection.replace(/^mp_[mf]_/, "")}`
    : tr("Базовая игра");

/*
 * Группы без запроса — полки, как вещи ищут в игре: сначала вещи сервера
 * (магазины, крупные выше, затем паки), потом вещи самой игры по
 * дополнениям — «GTA V · Ограбление казино». Внутри — названные раньше
 * безымянных. Первая полка раскрыта, остальные — по щелчку; небольшой
 * список раскрыт весь.
 */
export function browseTargetGroups(items, { many = false, beardFirst = false } = {}) {
  /* Модель бороды ставится на другую бороду проекта прежде всего (15.11.2026, владелец: «поставить замену на какую-то другую бороду, GTA 5 RP-шную или на Маджестике»): бороды и усы вкладки — отдельная раскрытая
     полка первой, маски ниже обычными полками. Бород в целях нет — полки нет, список как был. */
  const beards = beardFirst ? items.filter(isBeardItem) : [];
  const rest = beards.length ? items.filter((item) => !beards.includes(item)) : items;
  const shelves = new Map();
  for (const item of rest) {
    const game = !item.server;
    const shop = item.shop || null;
    const place = shop ? shownShop(shop) : many ? tr("Прочие") : packOf(item);
    /* Базовая игра (`BASE_SHOP`) — «белая футболка», «футболка банды»: полка называется просто «GTA V» и стоит первой среди вещей игры. */
    const base = game && shop === BASE_SHOP;
    const title = base ? BASE_SHOP : game && !many ? `GTA V · ${place}` : place;
    const key = `${game ? "game" : "server"}|${shop ? "shop" : "pack"}|${title}`;
    if (!shelves.has(key))
      shelves.set(key, {
        key,
        title,
        game,
        base,
        shop: Boolean(shop),
        server: item.server || null,
        items: [],
      });
    shelves.get(key).items.push(item);
  }
  const list = [...shelves.values()]
    .map((shelf) => ({
      ...shelf,
      items: shelf.items.sort(
        (left, right) =>
          Number(!left.name) - Number(!right.name) || left.drawable - right.drawable,
      ),
    }))
    .sort(
      (left, right) =>
        Number(left.game) - Number(right.game) ||
        Number(right.base) - Number(left.base) ||
        Number(right.shop) - Number(left.shop) ||
        (left.shop
          ? right.items.length - left.items.length
          : byName.compare(left.title, right.title)) ||
        byName.compare(left.title, right.title),
    );
  const small = items.length <= GROUP_PAGE * 3;
  const shelved = list.map((shelf, index) => ({ ...shelf, open: small || (index === 0 && !beards.length) }));
  if (!beards.length) return shelved;
  const sorted = [...beards].sort((left, right) => Number(!left.name) - Number(!right.name) || left.drawable - right.drawable);
  return [{ key: "beards", title: tr("Бороды и усы"), game: false, base: false, shop: false, server: null, items: sorted, open: true }, ...shelved];
}
