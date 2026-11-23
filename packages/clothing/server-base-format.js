/*
 * База вещей серверов — форма данных (задача 9 ТЗ 10.10.2026, вечер).
 *
 * Владелец: «там большая база всех одежд с проекта … ты должен это занести,
 * чтобы оно не лагало». Прежде вещи проектов Desktop брал с сайтов в
 * рантайме (`apps/desktop/src/project-clothing.js`): 4–6 МБ ответа nightz на
 * сервер и пол, до минуты ожидания при первом открытии «На что поставить?»,
 * без сети — пусто, а картинки — по запросу к чужому хостингу на каждую
 * строку. Теперь база лежит в Astral: `scripts/import-server-clothing.mjs`
 * снимает открытый каталог «Серверные файлы» nightz (MajesticRP, GTA5RP,
 * RMRP, оба пола) и вики GTA5RP и кладёт её в `server-base/` кусками —
 * сервер × пол × вид вещи. Окно грузит куски только того вида, что правят
 * (`server-base.js`), с сайтов в рантайме не грузится ничего.
 *
 * Здесь — как вещь лежит в куске и как обратно становится вещью
 * ассортимента. Строка куска — массив, колонки — `BASE_COLUMNS`:
 *
 *   folder   — номер папки в списке `folders` куска;
 *   drawable — номер файла (`jbib_072_u.ydd` → 72);
 *   suffix   — суффикс модели: `u`, `r` или пусто (у пропов);
 *   name     — имя на проекте; пусто — технический файл без имени;
 *   shop     — магазин (у GTA5RP — по вики), пусто — не знаем;
 *   global   — номер вещи на сервере (его магазин, вики), −1 — нет;
 *   textures — сколько букв расцветок ставить (до последней, ≤ 26);
 *   race     — раса текстур (`uni`, `whi`), пусто у пропов;
 *   flags    — `BASE_FLAGS`: имя не сверено с файлом, госформа, имя запасное (`fallbackName`);
 *   extra    — редкое: имена цветов брони, вместимость сумки, расцветки за «z».
 *
 * Группа форм (16.11.2026, необязательно): `extra.look` — номер группы строкой из цифр (≤ 6), `extra.lookRep` — «лицо» группы. Вещи одной группы — формы одного стиля
 * (те же расцветки по хешам файлов, модель своя на каждый крой торса, критерий `forms` из `game-looks.js`): окно складывает их в одну плитку (`lookTiles`), заменёнка
 * встаёт на все номера группы. Номера групп сервера не пересекаются с таблицей игры (Majestic с 700000, GTA 5 RP с 800000), номер стиля в разделе — остаток от 100000.
 * Без поля кусок читается побайтно как прежде; поле ставит `server-base-build.mjs look-groups`.
 *
 * Картинок в базе нет: превью сайта — чужой хостинг, а снимок с него — не
 * кадр из игры. В выборе у вещи сервера — значок её вида. Исключение — хэш:
 * у вещи без фото сервера (запасное имя) в `extra.pic` лежит sha256 обложки её
 * карточки каталога (64 hex, без адреса; ставит `server-base-build.mjs attach`).
 * Окно собирает адрес само, как адреса медиа каталога (`item-picture.js`).
 *
 * Чистый JS: окно, Desktop, скрипт и тесты.
 */

import { assortmentItem } from "./assortment.js";
import { COMPONENTS } from "./taxonomy.js";

export const BASE_SCHEMA = 1;

/* Серверы базы — id Astral (`taxonomy.js`) и имя источника у nightz. */
export const BASE_SERVERS = Object.freeze(["gta5rp", "majestic", "rmrp"]);
export const NIGHTZ_SOURCES = Object.freeze({
  gta5rp: "gta5rp",
  majestic: "majesticrp",
  rmrp: "rmrp",
});

export const BASE_COLUMNS = Object.freeze([
  "folder",
  "drawable",
  "suffix",
  "name",
  "shop",
  "global",
  "textures",
  "race",
  "flags",
  "extra",
]);

/* `fallback` (16.11.2026) — имя запасное («Футболка №7.12»: вид, номер коллекции, номер файла), а не имя проекта; загрузчик отдаёт вещи `fallbackName: true`. Окну по нему отличить настоящее имя от запасного, не разбирая текст. */
export const BASE_FLAGS = Object.freeze({ doubt: 1, government: 2, fallback: 4 });

/* sha256 обложки карточки — `extra.pic`; всё, что не 64 hex, игнорируется. */
const PICTURE_SHA = /^[a-f0-9]{64}$/i;
const pictureShaOf = (value) =>
  typeof value === "string" && PICTURE_SHA.test(value) ? value.toLowerCase() : "";

/* Номер группы форм — `extra.look`: цифры, не больше шести (как у таблицы игры, `assortment.js`); всё остальное игнорируется. */
const LOOK_ID = /^\d{1,6}$/;
const lookIdOf = (value) => (typeof value === "string" && LOOK_ID.test(value) ? value : "");

/*
 * Вкладки «Серверных файлов» nightz → компонент педа. Сверено по данным
 * 11.10.2026 у всех трёх серверов: вкладка — один компонент, кроме «Допов»
 * (`extras`) — там технические файлы любых видов без имён. «Шея» сайта
 * (`neck`) — нашивки `decl` (у Majestic вики зовёт их `decal`), а
 * «Аксессуары» — `teef`, то, что носят на шее.
 */
export const SITE_CATEGORY_COMPONENTS = Object.freeze({
  upper: "jbib",
  tops: "accs",
  bottoms: "lowr",
  shoes: "feet",
  masks: "berd",
  accessories: "teef",
  watches: "p_lwrist",
  bracelets: "p_rwrist",
  armor: "task",
  headwear: "p_head",
  hair: "hair",
  backpacks: "hand",
  glasses: "p_eyes",
  ears: "p_ears",
  neck: "decl",
  extras: null,
});

/*
 * `wikiType` ответа → компонент педа. У GTA5RP — номер компонента игры
 * (`p` — пропы; броня — `custom_ARM`), у Majestic — вид вещи их вики, у RMRP
 * его нет.
 */
export const WIKI_TYPE_COMPONENTS = Object.freeze({
  gta5rp: Object.freeze({
    1: "berd",
    4: "lowr",
    5: "hand",
    6: "feet",
    7: "teef",
    11: "jbib",
    p0: "p_head",
    p1: "p_eyes",
    p2: "p_ears",
    p6: "p_lwrist",
    p7: "p_rwrist",
    custom_ARM: "task",
  }),
  majestic: Object.freeze({
    top: "jbib",
    undershirt: "accs",
    legs: "lowr",
    shoes: "feet",
    mask: "berd",
    accessory: "teef",
    decal: "decl",
    bag: "hand",
    head: "p_head",
    glasses: "p_eyes",
    ear: "p_ears",
    watch: "p_lwrist",
  }),
  rmrp: Object.freeze({}),
});

export const baseKey = (server, gender, component) =>
  `${server}|${gender}|${component}`;

export const baseChunkFile = (server, gender, component) =>
  `${server}-${gender}-${component}.js`;

export const baseVanillaFile = (gender) => `gta5rp-vanilla-${gender}.js`;

const clean = (value, limit) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

const byPlace = (left, right) =>
  left.folder.localeCompare(right.folder) ||
  left.drawable - right.drawable ||
  String(left.modelSuffix || "").localeCompare(String(right.modelSuffix || ""));

/**
 * Вещи одного сервера, пола и вида → кусок. Порядок строк — папка и номер:
 * повторный снимок даёт дифф только там, где что-то поменялось.
 */
export function encodeBaseChunk({ server, gender, component, items }) {
  const list = [...items].sort(byPlace);
  const folders = [...new Set(list.map((item) => item.folder))];
  const index = new Map(folders.map((folder, at) => [folder, at]));
  const rows = list.map((item) => {
    const flags =
      (item.doubt && item.name ? BASE_FLAGS.doubt : 0) |
      (item.government ? BASE_FLAGS.government : 0) |
      (item.fallbackName && item.name ? BASE_FLAGS.fallback : 0);
    const extra = {};
    if (item.aliases?.length) extra.aliases = item.aliases.map((alias) => clean(alias, 120));
    if (item.capacityKg) extra.kg = item.capacityKg;
    if (item.over) extra.over = item.over;
    if (pictureShaOf(item.pictureSha)) extra.pic = pictureShaOf(item.pictureSha);
    if (lookIdOf(item.look?.id)) {
      extra.look = item.look.id;
      if (item.look.rep) extra.lookRep = true;
    }
    const row = [
      index.get(item.folder),
      item.drawable,
      item.modelSuffix || "",
      clean(item.name, 120),
      clean(item.shop, 80),
      Number.isInteger(item.global) ? item.global : -1,
      item.textures,
      item.race || "",
      flags,
    ];
    if (Object.keys(extra).length) row.push(extra);
    return row;
  });
  return { schema: BASE_SCHEMA, server, gender, component, folders, rows };
}

/**
 * Кусок → вещи ассортимента (источник `external`, как прежние вещи
 * проектов). Строка, которая не складывается в вещь (чужой пол, проп не в
 * папке пропов), пропускается — как у любого источника ассортимента.
 */
export function decodeBaseChunk(chunk) {
  const { server, gender, component, folders = [], rows = [] } = chunk || {};
  if (!COMPONENTS[component]) return [];
  const items = [];
  for (const row of rows) {
    const [at, drawable, suffix, name, shop, global, textures, race, flags = 0, extra = null] =
      row;
    const item = assortmentItem(
      {
        server,
        folder: folders[at],
        drawable,
        component,
        modelSuffix: suffix || null,
        race: race || null,
        textures,
        name: name || null,
        shop: shop || null,
        /* Группа форм — только если поле есть в куске; кусок без него даёт вещь, как прежде. */
        ...(lookIdOf(extra?.look) ? { look: extra.look, lookForms: true, ...(extra.lookRep === true ? { lookRep: true } : {}) } : {}),
      },
      "external",
    );
    if (!item || item.gender !== gender || !item.server) continue;
    items.push({
      ...item,
      doubt: Boolean(name) && Boolean(flags & BASE_FLAGS.doubt),
      ...(global >= 0 ? { global } : {}),
      ...(flags & BASE_FLAGS.government ? { government: true } : {}),
      ...(name && flags & BASE_FLAGS.fallback ? { fallbackName: true } : {}),
      ...(extra?.aliases?.length ? { aliases: [...extra.aliases] } : {}),
      ...(extra?.kg ? { capacityKg: extra.kg } : {}),
      ...(extra?.over ? { over: extra.over } : {}),
      ...(pictureShaOf(extra?.pic) ? { pictureSha: pictureShaOf(extra.pic) } : {}),
    });
  }
  return items;
}

/*
 * Вещи вики GTA5RP без файла на сервере — вещи GTA Online под именами
 * проекта. Строка: вид, номер на сервере, имя, магазин, расцветок, госформа.
 * Место в игре даёт порядок вещей игры игрока (Desktop,
 * `vanillaAssortment`) — у окна без игры его нет.
 */
export function encodeBaseVanilla(gender, rows) {
  const list = [...rows].sort(
    (left, right) =>
      left.component.localeCompare(right.component) || left.global - right.global,
  );
  return {
    schema: BASE_SCHEMA,
    server: "gta5rp",
    gender,
    rows: list.map((row) => [
      row.component,
      row.global,
      clean(row.name, 120),
      clean(row.shop, 80),
      row.textures,
      row.government ? BASE_FLAGS.government : 0,
    ]),
  };
}

export function decodeBaseVanilla(chunk) {
  const gender = chunk?.gender;
  return (chunk?.rows || [])
    .filter((row) => COMPONENTS[row[0]] && Number.isInteger(row[1]))
    .map(([component, global, name, shop, textures, flags = 0]) => ({
      gender,
      component,
      global,
      name: name || null,
      shop: shop || null,
      textures: Math.max(1, Math.min(26, Number(textures) || 1)),
      ...(flags & BASE_FLAGS.government ? { government: true } : {}),
    }));
}
