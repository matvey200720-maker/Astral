/*
 * Вещи проектов — «На что поставить?» с настоящими вещями и их картинками
 * (задача 2 ТЗ 06.10.2026).
 *
 * Прежде у сервера в выборе были только имена из «Заменяет» модов каталога и
 * файлы его клиента на ПК (без имён), а у брони — цвета жилета GTA Online
 * («Серый», «Оливковый»). Теперь у каждой вещи сервера — её имя на проекте,
 * магазин, файл и картинка оригинала. Источники — открытые данные:
 *
 *   • nightz «Серверные файлы» (`nightzmodz.site/api/replaces`): все файлы
 *     одежды серверных паков GTA5RP, Majestic и RMRP — папка, файл,
 *     расцветки, сквозной номер вещи на сервере, имя (где известно) и
 *     картинка **оригинала** (у GTA5RP и Majestic — картинка самого проекта,
 *     у остальных — рендер файла сервера, не кадр из игры);
 *   • официальная вики GTA5RP (`wiki.gta5rp.com/clothes`): имя вещи, магазин
 *     («Спортивный магазин», «Люкс магазин», события и пропуска), сквозной
 *     номер и картинки сервера `files.gta5rp.com/Clothes512`.
 *
 * Моды оттуда не берутся — только имена, места (папка и номер) и картинки:
 * человек видит, на какую вещь ставит заменёнку. Данные в Astral не хранятся
 * (как и вики Majestic): Desktop читает их в рантайме и держит в кэше
 * (`apps/desktop/src/project-clothing.js`), картинки — тоже через Desktop
 * (окно чужих картинок не грузит).
 *
 * Сквозной номер вещи на сервере = сдвиг пака + номер файла, паки идут
 * подряд. Где nightz ошибся (один номер — два файла, выброс сдвига), вещь
 * остаётся, но имя у неё не берётся или помечено «файл не сверен». У брони
 * GTA5RP своих номеров в nightz нет: они вычислены по картинкам (skins2 —
 * 56 + номер файла, skins6 — 87 + номер), имена цветов — с рулетки сервера.
 *
 * Чистый JS: разбор и склейка — здесь (окно, главный процесс, тесты).
 */

import { assortmentItem } from "./assortment.js";
import { COMPONENTS } from "./taxonomy.js";

export const NIGHTZ_ORIGIN = "https://nightzmodz.site";
export const GTA5RP_WIKI_URL = "https://wiki.gta5rp.com/clothes";
export const GTA5RP_FILES = "https://files.gta5rp.com";

/* Источник nightz для сервера Astral. */
const NIGHTZ_SOURCE = Object.freeze({
  gta5rp: "gta5rp",
  majestic: "majesticrp",
  rmrp: "rmrp",
});
export const PROJECT_SERVERS = Object.freeze(Object.keys(NIGHTZ_SOURCE));

/*
 * RMRP nightz отдаёт целиком (оба пола) под `gender=male`, под `female` —
 * пусто; пол вещи — по её папке.
 */
export const nightzRequestGender = (server, gender) =>
  server === "rmrp" ? "male" : gender;

export const nightzUrl = (server, gender) =>
  `${NIGHTZ_ORIGIN}/api/replaces?source=${NIGHTZ_SOURCE[server]}&gender=${nightzRequestGender(server, gender)}`;

/*
 * Хосты картинок: CDN проектов и картинки nightz (они переадресуют на свой
 * CDN). Desktop ходит только сюда.
 */
export const PICTURE_HOSTS = Object.freeze([
  "files.gta5rp.com",
  /* Наше зеркало фото вещей (`photos.js`, 28.10.2026). */
  "cdn.astral-mods.online",
  "cdn.majestic-files.com",
  "cdn.majestic-files.net",
  "nightzmodz.site",
  "cdn.nightzmodz.site",
]);

/** Можно ли Desktop взять картинку по адресу: https и хост из списка. */
export function pictureAllowed(url) {
  try {
    const target = new URL(String(url || ""));
    return (
      target.protocol === "https:" &&
      !target.username &&
      !target.password &&
      PICTURE_HOSTS.includes(target.hostname)
    );
  } catch {
    return false;
  }
}

/* Номер компонента в вики и на CDN GTA5RP. */
const WIKI_COMPONENT = Object.freeze({
  berd: "1",
  uppr: "3",
  lowr: "4",
  hand: "5",
  feet: "6",
  teef: "7",
  accs: "8",
  task: "9",
  decl: "10",
  jbib: "11",
  p_head: "p0",
  p_eyes: "p1",
  p_ears: "p2",
  p_lwrist: "p6",
  p_rwrist: "p7",
});
const COMPONENT_OF_WIKI = Object.freeze(
  Object.fromEntries(
    Object.entries(WIKI_COMPONENT).map(([component, id]) => [id, component]),
  ),
);

/* Магазины GTA5RP — полки выбора; события и пропуска идут своими полками. */
const SHOPS = new Set([
  "Спортивный магазин",
  "Премиум магазин",
  "Люкс магазин",
  "Ювелирный магазин",
  "Свадебный магазин",
  "Магазин масок",
]);

const FOLDER = /^mp_([mf])_freemode_01(_p)?(?:_([a-z0-9_]{1,64}))?$/;
const FILE = /^(p_[a-z]+|[a-z]+)_(\d{3})(?:_([ur]))?\.ydd$/i;
const TEXTURE = /_diff_\d{3}_([a-z])(?:_([a-z]{3}))?\.ytd$/i;
/* Расцветка за «z» (27-я и дальше: `_{_`, `_0x007C_`) — у масок Majestic.
   Буква с опечаткой в расе (`_c_un.ytd` у GTA5RP) — не она. */
const OVER_Z = /_diff_\d{3}_(?![a-z][_.]).+\.ytd$/i;

/*
 * Расцветки файла сервера → сколько букв ставить и какой расы.
 *
 * Букв — до последней, а не столько, сколько файлов: у GTA5RP бывают дыры
 * (`jbib_017`: a, b, d…n — у «c» опечатка `_un.ytd`), и замена по числу
 * файлов не дошла бы до «n». Дыра заполняется той же расцветкой — лишний
 * файл безвреден. Раса — та, что у модели: `_u` носит `_uni`, `_r` —
 * `_whi`; у редких вещей обе расы у одной буквы — ставится раса модели
 * (задача 9 ТЗ 10.10.2026, вечер).
 */
export function textureLayout(textures, modelSuffix = null) {
  let last = -1;
  let over = 0;
  const lettersOf = new Map();
  for (const texture of textures || []) {
    const name = String(texture?.fileName || "");
    const match = TEXTURE.exec(name);
    if (!match) {
      if (OVER_Z.test(name)) over += 1;
      continue;
    }
    const letter = match[1].toLowerCase();
    last = Math.max(last, letter.charCodeAt(0) - 97);
    const race = match[2]?.toLowerCase() || "";
    if (!lettersOf.has(race)) lettersOf.set(race, new Set());
    lettersOf.get(race).add(letter);
  }
  const ranked = [...lettersOf.entries()].sort(
    (left, right) =>
      right[1].size - left[1].size || left[0].localeCompare(right[0]),
  );
  const race =
    modelSuffix === "u" && lettersOf.has("uni")
      ? "uni"
      : modelSuffix === "r"
        ? ranked.find(([value]) => value && value !== "uni")?.[0] ||
          ranked[0]?.[0] ||
          ""
        : ranked[0]?.[0] || "";
  return {
    textures: Math.max(1, Math.min(26, last + 1 || (textures || []).length || 1)),
    race: race || null,
    over,
  };
}

const clean = (value, limit) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

const absolute = (url) => {
  const text = String(url || "");
  if (!text) return null;
  if (/^https:\/\//i.test(text)) return text;
  if (text.startsWith("/")) return `${NIGHTZ_ORIGIN}${text}`;
  return null;
};

const genderLetter = (gender) => (gender === "female" ? "f" : "m");

/** Картинка вещи GTA5RP по сквозному номеру: `files.gta5rp.com/Clothes512`. */
export const gta5rpPicture = (gender, component, global, texture = 0) =>
  WIKI_COMPONENT[component] && Number.isInteger(global)
    ? `${GTA5RP_FILES}/Clothes512/${genderLetter(gender)}_${WIKI_COMPONENT[component]}_${global}_${texture}.png`
    : null;

/*
 * Картинка из ответа nightz: у GTA5RP — картинка сервера (зеркало nightz
 * переводится на CDN проекта), у Majestic — CDN вики, остальное — рендер
 * файла сервера на сайте nightz.
 */
export function pictureOf(imageUrl) {
  const text = String(imageUrl || "");
  if (!text) return null;
  let match = /^\/images\/gta5rp\/(Clothes512|Roulette)\/([^/?#]+)\.webp$/i.exec(
    text,
  );
  if (match)
    return {
      url: `${GTA5RP_FILES}/${match[1]}/${match[2]}.png`,
      kind: "official",
      roulette: match[1] === "Roulette" ? match[2] : null,
    };
  if (/^https:\/\/cdn\.majestic-files\.(?:com|net)\//i.test(text))
    return { url: text, kind: "official", roulette: null };
  const url = absolute(text);
  return url && pictureAllowed(url) ? { url, kind: "render", roulette: null } : null;
}

/*
 * Пропы у nightz записаны в папке одежды без `_p`; в игре проп дополнения
 * живёт в `mp_X_freemode_01_p_<коллекция>` (как `propsFolder` оглавления
 * игры).
 */
const propFolder = (folder) =>
  folder.replace(/^(mp_[mf]_freemode_01)_(?!p_)/, "$1_p_");

/**
 * Ответ nightz → короткие строки: пол, вид, папка, номер, сквозной номер,
 * число расцветок, имя, картинка. Вещь без понятного файла пропускается.
 */
export function nightzRows(answer) {
  const rows = [];
  for (const raw of answer?.source?.items || []) {
    const file = FILE.exec(String(raw?.fileName || "").toLowerCase());
    if (!file) continue;
    const component = file[1];
    if (!COMPONENTS[component]) continue;
    const prop = COMPONENTS[component].prop;
    let folder = String(raw?.folderName || "").toLowerCase();
    if (prop && !/^mp_[mf]_freemode_01_p(?:_|$)/.test(folder))
      folder = propFolder(folder);
    const place = FOLDER.exec(folder);
    if (!place || Boolean(place[2]) !== prop) continue;
    const modelSuffix = file[3]?.toLowerCase() || null;
    const layout = textureLayout(raw.textures, modelSuffix);
    const technical = !raw.name || /\.ydd$/i.test(String(raw.name));
    const picture = pictureOf(raw.imageUrl);
    rows.push({
      gender: place[1] === "f" ? "female" : "male",
      component,
      folder,
      drawable: Number(file[2]),
      global: Number.isInteger(raw.modelId) ? raw.modelId : null,
      textures: layout.textures,
      ...(layout.over ? { over: layout.over } : {}),
      modelSuffix,
      race: prop ? null : layout.race,
      name: technical ? null : clean(raw.name, 120),
      picture: picture?.url || null,
      pictureKind: picture?.kind || null,
      roulette: picture?.roulette || null,
      mapping: clean(raw.wikiMappingMethod, 60) || null,
      capacityKg: Number.isFinite(raw.capacityKg) ? raw.capacityKg : null,
    });
  }
  return rows;
}

/*
 * Данные вики GTA5RP — в странице Next.js (поток RSC `self.__next_f`):
 * объект `{ data: { models }, clotheMarks, flags }`. Вырезается по скобкам,
 * строки JSON учитываются.
 */
function objectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * Страница вики GTA5RP → строки вещей: пол, вид, сквозной номер, имя,
 * магазин, число расцветок, госформа. `null` — страница сменила формат.
 */
export function parseGta5rpWiki(html) {
  const pushes = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let payload = "";
  let match;
  while ((match = pushes.exec(String(html || "")))) {
    try {
      payload += JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
  const at = payload.indexOf('{"data":{"models":');
  if (at < 0) return null;
  let data;
  try {
    data = JSON.parse(objectAt(payload, at));
  } catch {
    return null;
  }
  const models = data?.data?.models;
  if (!Array.isArray(models) || !models.length) return null;
  const shopOf = new Map();
  for (const group of data.clotheMarks || [])
    for (const mark of group.marks || []) shopOf.set(mark, clean(group.name, 60));
  const government = new Set(
    Object.entries(data.flags || {})
      .filter(([, flags]) => Array.isArray(flags) && flags.includes("gov"))
      .map(([file]) => file),
  );
  const rows = [];
  for (const model of models) {
    const component = COMPONENT_OF_WIKI[String(model?.componentId)];
    if (!component || !Number.isInteger(model?.modelId)) continue;
    const shops = [
      ...new Set((model.marks || []).map((mark) => shopOf.get(mark) || null).filter(Boolean)),
    ];
    const variants = (model.variants || []).map((variant) => String(variant?.id || ""));
    const genders = model.unisex ? ["male", "female"] : [model.gender];
    for (const gender of genders) {
      if (gender !== "male" && gender !== "female") continue;
      rows.push({
        gender,
        component,
        global: model.modelId,
        name: clean(model.name, 120),
        shop: shops.find((shop) => SHOPS.has(shop)) || shops[0] || null,
        textures: Math.max(1, Math.min(26, variants.length || 1)),
        government: variants.some((file) => government.has(file)),
      });
    }
  }
  return rows.length ? rows : null;
}

/* Бронежилеты GTA5RP: сквозной номер = сдвиг пака + номер файла
   (сверено по картинкам сервера, оба пола). */
const GTA5RP_ARMOR = Object.freeze({ gta5rp_skins2: 56, gta5rp_skins6: 87 });

/* Самые надёжные сопоставления nightz «файл ↔ номер на сервере». */
const SURE_MAPPINGS = new Set([
  "audit-approved-live-single",
  "bags-live-single",
  "bags-live-variant-map",
  "mapper-verified",
  "mapper-verified-folder-alias",
  "paired-male-mapper-verified",
  "source-exact",
  "source-texture-mismatch",
]);

/**
 * Вещи проекта одного пола — в форме ассортимента (источник `external`):
 * имя и магазин (у GTA5RP — по вики), картинка оригинала и что она такое
 * (`pictureKind`: `official` — картинка проекта, `render` — рендер файла),
 * имена расцветок брони (`aliases`), сомнение в файле (`doubt`).
 * `vanilla` — вещи вики GTA5RP без файла на сервере (вещи самой игры):
 * их место решает оглавление игры игрока.
 */
export function projectAssortment(server, gender, { rows = [], wiki = null } = {}) {
  /* Копии: строки — из кэша Desktop, правка номера брони и имён здесь своя. */
  const own = rows.filter((row) => row.gender === gender).map((row) => ({ ...row }));
  const wikiOf = new Map();
  for (const row of wiki || [])
    if (row.gender === gender) wikiOf.set(`${row.component}|${row.global}`, row);

  /* Броня GTA5RP: номер по картинкам сервера, имена цветов — с рулетки. */
  const armorAt = new Map();
  if (server === "gta5rp")
    for (const row of own) {
      if (row.component !== "task") continue;
      const pack = /(gta5rp_skins\d)$/.exec(row.folder)?.[1];
      if (GTA5RP_ARMOR[pack] === undefined) continue;
      row.global = GTA5RP_ARMOR[pack] + row.drawable;
      row.picture = gta5rpPicture(gender, "task", row.global);
      row.pictureKind = "official";
      row.armor = true;
      armorAt.set(row.global, row);
    }
  const colourNames = new Map();
  for (const row of own) {
    const match = row.roulette && /^ARM_(\d+)_(\d+)$/.exec(row.roulette);
    if (!match || !row.name) continue;
    const target = armorAt.get(Number(match[1]));
    if (!target) continue;
    const list = colourNames.get(target) || [];
    list.push(`${row.name} — цвет ${Number(match[2]) + 1}`);
    colourNames.set(target, list);
    /* Имя рулетки принадлежит другому жилету: у этого файла его нет. */
    if (row !== target) row.name = null;
  }

  /*
   * Один сквозной номер — несколько файлов (nightz записал вещь в два пака):
   * верен файл из пака с одним сдвигом на все вещи — паки идут подряд, и
   * у верного пака сдвиг ровный. Остальные остаются вещами без имени и
   * картинки проекта. Выброс сдвига внутри пака — «файл не сверен».
   */
  const offsetsOf = (list) => {
    const offsets = new Map();
    for (const row of list) {
      if (row.global === null || row.armor) continue;
      const key = `${row.folder}|${row.component}`;
      const counts = offsets.get(key) || new Map();
      const offset = row.global - row.drawable;
      counts.set(offset, (counts.get(offset) || 0) + 1);
      offsets.set(key, counts);
    }
    return offsets;
  };
  const spreadOf = offsetsOf(own);
  const spread = (row) =>
    spreadOf.get(`${row.folder}|${row.component}`)?.size ?? Infinity;
  const byGlobal = new Map();
  for (const row of own) {
    if (row.global === null || row.armor) continue;
    const key = `${row.component}|${row.global}`;
    byGlobal.set(key, [...(byGlobal.get(key) || []), row]);
  }
  const doubtful = new Set();
  const nameless = new Set();
  for (const list of byGlobal.values()) {
    if (list.length < 2) continue;
    const best = Math.min(...list.map(spread));
    const keepers = list.filter((row) => spread(row) === best);
    const keep = keepers.length === 1 ? keepers[0] : null;
    for (const row of list)
      if (row !== keep) (keep ? nameless : doubtful).add(row);
  }
  const norms = offsetsOf(own.filter((row) => !nameless.has(row)));
  const normOf = (row) => {
    const counts = norms.get(`${row.folder}|${row.component}`);
    return counts
      ? [...counts].sort((left, right) => right[1] - left[1])[0][0]
      : null;
  };
  for (const row of own)
    if (
      row.global !== null &&
      !row.armor &&
      !nameless.has(row) &&
      row.global - row.drawable !== normOf(row)
    )
      doubtful.add(row);

  const items = [];
  const mapped = new Set();
  for (const row of own) {
    const fromWiki =
      server === "gta5rp" && row.global !== null && !nameless.has(row)
        ? wikiOf.get(`${row.component}|${row.global}`)
        : null;
    if (fromWiki) mapped.add(`${row.component}|${row.global}`);
    /* Броня GTA5RP без имени — под номером сервера, как на его рулетке (ARM_56). */
    const name = nameless.has(row)
      ? null
      : fromWiki?.name ||
        row.name ||
        (row.armor ? `Бронежилет №${row.global}` : null);
    /* Картинка проекта — по сквозному номеру; файл с чужим номером — без неё. */
    const picture =
      nameless.has(row) && row.pictureKind === "official"
        ? null
        : server === "gta5rp" && row.global !== null && !nameless.has(row)
          ? gta5rpPicture(gender, row.component, row.global) || row.picture
          : row.picture;
    const item = assortmentItem(
      {
        server,
        folder: row.folder,
        drawable: row.drawable,
        component: row.component,
        textures: Math.max(row.textures, fromWiki?.textures || 1),
        modelSuffix: row.modelSuffix,
        race: row.race,
        name,
        shop: fromWiki?.shop || null,
        preview: picture,
      },
      "external",
    );
    if (!item) continue;
    const sure =
      SURE_MAPPINGS.has(row.mapping) || Boolean(fromWiki) || row.armor;
    items.push({
      ...item,
      pictureKind: picture ? (picture === row.picture ? row.pictureKind : "official") : null,
      doubt: Boolean(name) && (doubtful.has(row) || !sure),
      ...(colourNames.get(row)?.length ? { aliases: colourNames.get(row) } : {}),
      ...(row.capacityKg ? { capacityKg: row.capacityKg } : {}),
      ...(fromWiki?.government ? { government: true } : {}),
      /* Номер вещи на сервере (его магазин и вики) и расцветки за «z». */
      ...(row.global !== null && !nameless.has(row) ? { global: row.global } : {}),
      ...(row.over ? { over: row.over } : {}),
    });
  }

  /* Вещи вики без файла на сервере: место решает оглавление игры. */
  const vanilla = [];
  if (server === "gta5rp")
    for (const row of wiki || []) {
      if (row.gender !== gender || mapped.has(`${row.component}|${row.global}`)) continue;
      vanilla.push({
        gender,
        component: row.component,
        global: row.global,
        name: row.name,
        shop: row.shop,
        textures: row.textures,
        picture: gta5rpPicture(gender, row.component, row.global),
      });
    }
  return { items, vanilla };
}

/**
 * Вещи самой игры под именами проекта (GTA5RP продаёт и вещи GTA Online):
 * сквозной номер вещи на сервере — её место в списке игры (`placesOf(вид)`
 * — `[{ folder, drawable, textures } | null]` этого пола по порядку игры,
 * `apps/desktop/src/game-clothing-order.js`). Вещь берётся, только если
 * место подтверждено: база игры (номера в ней не сдвигаются) или у вещи
 * игры столько же расцветок, сколько у вещи на сервере, — иначе номер мог
 * разойтись с версией игры сервера, и заменёнка встала бы не туда.
 */
export function vanillaAssortment(server, vanilla = [], placesOf = () => null) {
  const items = [];
  for (const row of vanilla) {
    const place = placesOf(row.component)?.[row.global];
    if (!place) continue;
    /* Номер вещи ранней коллекции (паки x64w и `mppatchesng`) игрой не подтверждён целиком: такую вещь не предлагаем, пока порядок не доказан (кадры 15.11.2026, `game-clothing-order.js`). */
    if (place.unconfirmed) continue;
    const base = /^mp_[mf]_freemode_01(?:_p)?$/.test(place.folder);
    if (!base && place.textures !== row.textures) continue;
    const item = assortmentItem(
      {
        server,
        folder: place.folder,
        drawable: place.drawable,
        component: row.component,
        textures: place.textures || row.textures,
        name: row.name,
        shop: row.shop,
        preview: row.picture,
      },
      "external",
    );
    if (item) items.push({ ...item, pictureKind: "official", doubt: false, byGame: true });
  }
  return items;
}
