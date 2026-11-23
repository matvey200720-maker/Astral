/*
 * Модели одежды для мастерской — из игры игрока и из каталога Astral.
 *
 * Своих моделей одежды Astral не возит: это ассеты Rockstar, и в поставку
 * они не входят. Но у человека игра стоит, и в её архивах лежит вся одежда
 * свободного персонажа: маски, футболки, штаны, обувь — сотнями. Мастерская
 * одежды открывает «Маски» — и в «Виде» стоят маски из его же игры, как у
 * оружия стоят стволы из его игры. Модель собирается нативным
 * `convert-model` (тот же, что у оружия и превью каталога) и кладётся в
 * кэш: второй раз та же маска открывается сразу.
 *
 * Вещь из каталога — это пакет Astral Clothing DLC: подписанный манифест и
 * файлы `.ydd`/`.ytd`. Пакет скачивается тем же доверенным путём, что и при
 * установке (`downloadSignedPackage` — подпись, sha256, разрешённые хосты),
 * и собирается в модель так же. Так человек берёт из каталога кофту и
 * ставит на её эмблему свою.
 *
 * Имена компонентов в игре не бытовые: `jbib` — верх, `lowr` — низ, `berd` —
 * маска, `task` — бронежилет, `hand` — ранцы и рюкзаки. Таблица ниже та же,
 * что у скрипта превью каталога (`scripts/extract-clothing-preview-assets.js`),
 * только там у каждой категории одна вещь для карточки, а здесь — все.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { downloadSignedPackage } from "@modovik/install-engine";
import { renameWithRetry } from "@modovik/install-engine/engine-state.js";
import {
  clothingDrawable,
  clothingModelGlb,
  colourPicture,
  isStubPicture,
  showcaseDrawable,
} from "@modovik/clothing/model";
import { armorItemName, armorItemWords } from "@modovik/clothing/armor";
import { alternatesOf } from "@modovik/clothing/model-variants";
import { encodePngFast } from "./png-fast.js";
import { garmentShape } from "@modovik/clothing/garment-shape";
import { BLANK_MODEL_BYTES } from "@modovik/clothing/game-assortment";
import { compareColourNames } from "@modovik/clothing/colour-files";
import {
  folderGender,
  folderOfGender,
  validVariant,
  variantGender,
  withGender,
} from "@modovik/clothing/gender";
import { inflateRawNode } from "@modovik/rpf7/node";
import { fileURLToPath } from "node:url";
import { callNativeEngine } from "./native-engine.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { listThroughCache, readThroughCache } from "./clothing-read-cache.js";
import {
  componentItems,
  readGameClothingIndex,
} from "./game-clothing-index.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const FREEMODE = "models/cdimages/streamedpeds_mp.rpf/mp_m_freemode_01";
export const FREEMODE_PROPS =
  "models/cdimages/streamedpedprops.rpf/mp_m_freemode_01_p";
export const PARACHUTES =
  "dlcpacks/mplts/dlc.rpf/x64/models/cdimages/mplts.rpf" +
  "/mp_m_freemode_01_male_freemode_mplts";

/*
 * «Большая сумка» GTA5RP — штатные сумки ограбления казино из DLC
 * `mpheist3` (hand_000…003, сверено по моду из Discord Astral Mods): её
 * красят с оригинала из игры игрока. Архив вложенный, и его имя внутри
 * dlc.rpf не угадывается — папка вещи находится по оглавлению.
 *
 * Сама модель `hand_000_u.ydd` — пустая сумка: один квадрат 3×5 см. Сумку
 * игра берёт из ступеней наполнения `hand_000_u_1…26.ydd` (1708 вершин,
 * сверено 04.10.2026). Показ и покраска — по самой полной ступени, текстуры
 * у всех ступеней общие (`hand_diff_000_*`).
 */
const HEIST3 = "mp_m_freemode_01_mp_m_heist3";
const BIG_BAG = Object.freeze({
  name: "Большая сумка GTA5RP",
  archive: "update/x64/dlcpacks/mpheist3/dlc.rpf",
  folder: HEIST3,
  drawable: 0,
  /* Сервер показывает её на четырёх номерах — замена встаёт на все. */
  places: Object.freeze([0, 1, 2, 3]),
  server: "gta5rp",
  serverName: "Большая сумка",
});

/*
 * Номера вещей из других архивов в «Моделях»: после вещей категории, чтобы
 * «Сумка №3» из парашютов и большая сумка не делили один номер.
 */
export const EXTRA_VARIANT = 1000;
/* Мужские числа — до 1999; женские — те же, сдвинутые на `FEMALE_VARIANT` (`@modovik/clothing/gender`). */
const MAX_VARIANT = EXTRA_VARIANT + 999;

/*
 * Откуда брать вещи категории. У госодежды своего компонента у свободного
 * персонажа нет — это форма патрульного из модели полицейского, одна вещь.
 * У тату игры модели нет — это наложение на кожу; тату модов — вещи
 * каталога (сетка тела вместо аксессуара), они приходят оттуда.
 */
export const CLOTHING_SOURCES = Object.freeze({
  armor: { archive: "x64v.rpf", folder: FREEMODE, component: "task" },
  tshirts: { archive: "x64v.rpf", folder: FREEMODE, component: "jbib" },
  pants: { archive: "x64v.rpf", folder: FREEMODE, component: "lowr" },
  shoes: { archive: "x64v.rpf", folder: FREEMODE, component: "feet" },
  masks: { archive: "x64v.rpf", folder: FREEMODE, component: "berd" },
  /* Причёска-вещь (14.11.2026, слово владельца: заменёнка на любую причёску): штатные `hair_NNN` свободного персонажа; надетая заменяет причёску облика. */
  hair: { archive: "x64v.rpf", folder: FREEMODE, component: "hair" },
  /* Борода — тот же компонент `berd`, что у маски (в игре это одно место). Штатной бороды-модели нет (рисунок на лице), список «Из GTA 5» окно у неё не просит:
     слот для вещей каталога и установки. Стоит после `masks`: `slotOfComponent("berd")` по-прежнему «masks». */
  beards: { archive: "x64v.rpf", folder: FREEMODE, component: "berd" },
  hats: { archive: "x64v.rpf", folder: FREEMODE_PROPS, component: "p_head" },
  accessories: {
    archive: "x64v.rpf",
    folder: FREEMODE_PROPS,
    component: "p_eyes",
  },
  gloves: { archive: "x64w.rpf", folder: PARACHUTES, component: "uppr" },
  bags: {
    archive: "x64w.rpf",
    folder: PARACHUTES,
    component: "hand",
    extras: Object.freeze([BIG_BAG]),
  },
  "government-clothing": {
    archive: "x64e.rpf",
    folder: "models/cdimages/componentpeds_s_m_y.rpf",
    fixed: Object.freeze([
      {
        variant: 0,
        model: "s_m_y_cop_01.ydd",
        texture: "s_m_y_cop_01.ytd",
        drawable: "uppr_000_r",
      },
    ]),
  },
});

/* Больше в «Виде» не нужно: дальше — прокрутка без конца и одинаковые вещи. */
export const MAX_CLOTHING_VARIANTS = 160;
const MAX_MODEL_BYTES = 48 * 1024 * 1024;

const refusal = (code, message) => Object.assign(new Error(message), { code });

/*
 * Женский источник той же категории (ТЗ 29.10.2026): те же архивы и компоненты, папка женского персонажа
 * (`mp_f_freemode_01`, пропсы — `…_p`, перчатки и сумки — `…_female_freemode_mplts`). Вещей из других архивов (большая
 * сумка GTA5RP) у женщины нет: у сервера её женская пара — другая вещь.
 */
const femaleSources = new Map();
function femaleSource(source) {
  if (!femaleSources.has(source)) {
    const { extras: _extras, ...rest } = source;
    femaleSources.set(source, Object.freeze({ ...rest, ...(rest.folder ? { folder: folderOfGender(rest.folder, "female") } : {}) }));
  }
  return femaleSources.get(source);
}

export function clothingSource(slot, gender = "male") {
  const id = String(slot || "").trim();
  const source = Object.hasOwn(CLOTHING_SOURCES, id)
    ? CLOTHING_SOURCES[id]
    : null;
  if (!source)
    throw refusal(
      "CLOTHING_SLOT",
      id === "tattoos"
        ? "Тату игры — наложения на кожу, модели у них нет. Основа тату — тату сервера из кэша его клиента на этом ПК и тату-вещи каталога: облегающая сетка тела с рисунком."
        : "Эту категорию одежды Astral не знает.",
    );
  return gender === "female" && !source.fixed ? femaleSource(source) : source;
}

/** Категория «Моделей» по компоненту вещи (`jbib` → `tshirts`); `null` — у компонента нет вещей свободного персонажа в «Моделях» (госодежда, тату). */
export const slotOfComponent = (component) =>
  Object.entries(CLOTHING_SOURCES).find(([, source]) => !source.fixed && source.component === component)?.[0] || null;

/** Пол запроса: явный `gender` или пол числа вещи в «Моделях». */
export const requestGender = (input) =>
  input?.gender === "female" || variantGender(Number(input?.variant)) === "female" ? "female" : "male";

export function clothingGameRoot(input) {
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot))
    throw refusal("CLOTHING_GAME", "Выберите папку GTA V Legacy.");
  return path.resolve(gameRoot);
}

export const gameHash = (gameRoot) =>
  createHash("sha256")
    .update(gameRoot.toLowerCase())
    .digest("hex")
    .slice(0, 16);

/* Файл модели вещи: у части компонентов суффикс `_u`, у части `_r`. */
function modelName(files, component, variant) {
  const number = String(variant).padStart(3, "0");
  for (const suffix of ["_u", "_r", ""]) {
    const name = `${component}_${number}${suffix}.ydd`;
    if (files.has(name)) return name;
  }
  return null;
}

/*
 * Ступени вещи: `hand_000_u_1.ydd`, `hand_000_u_2.ydd`… рядом с
 * `hand_000_u.ydd` (сумка ограбления наполняется добычей). Показ — по
 * последней, самой полной; нет ступеней — `null`.
 */
function fullestStage(files, model) {
  const stem = model.replace(/\.ydd$/i, "");
  let best = null;
  for (const name of files.keys()) {
    const match = /^(.+)_(\d{1,2})\.ydd$/i.exec(name);
    if (!match || match[1].toLowerCase() !== stem.toLowerCase()) continue;
    const stage = Number(match[2]);
    if (!best || stage > best.stage) best = { stage, name };
  }
  return best?.name || null;
}

/*
 * Расцветки вещи по буквам (a, b, c…) и самая крупная из них — запасной
 * выбор. Лицо вещи выбирается по пикселям (`chooseGameTexture`): у части
 * вещей крупнейшая буква — шахматка-заглушка.
 */
function textureNames(files, component, variant) {
  const number = String(variant).padStart(3, "0");
  const pattern = new RegExp(
    `^${component}_diff_${number}_[a-z](_[a-z]+)?\\.ytd$`,
  );
  /* Порядок — общий с оглавлением и плиткой (`compareColourNames`, `packages/clothing/colour-files.js`): расцветка N — один и тот же файл у плитки, `texturesOf` и этого списка. Кодовые единицы (`.sort()`) ставили `x_a` перед `x_a_uni`, локаль — после. */
  const names = [...files.keys()].filter((name) => pattern.test(name)).sort(compareColourNames);
  let best = null;
  for (const name of names)
    if (!best || files.get(name) > files.get(best)) best = name;
  return { names, largest: best };
}

/** Чтение архивов игры: оглавление папки и один файл из неё; опись вещей игры. */
export const clothingArchiveTools = (stateDir) => ({
  shapes: () => readGameShapes(),
  /* Оглавление папки — тоже через кэш на диске: ответ не меняется, пока не изменился архив (15.11.2026). */
  list: async (input, context) => {
    const gameRoot = String(input?.gameRoot || "");
    return listThroughCache(stateDir, gameRoot ? gameHash(path.resolve(gameRoot)) : "", input, async (request) => {
      const support = await provisionArchiveSupport({ stateDir });
      return callNativeEngine(
        "list-archive-entries",
        { ...request, keys: support.directory },
        context,
      );
    });
  },
  /* Файл из архива игры — через кэш на диске (`clothing-read-cache.js`, 15.11.2026): один раз прочитанное тело и вещи на занятом диске не открывают архивы заново. */
  read: async (input, context) => {
    const gameRoot = String(input?.gameRoot || "");
    return readThroughCache(stateDir, gameRoot ? gameHash(path.resolve(gameRoot)) : "", input, async (request) => {
      const support = await provisionArchiveSupport({ stateDir });
      return callNativeEngine(
        "read-archive-file",
        { ...request, keys: support.directory },
        context,
      );
    });
  },
  native: callNativeEngine,
  download: downloadSignedPackage,
  /* Оглавление одежды самой игры (дополнения GTA Online): читается на JS. */
  index: async ({ gameRoot, stateDir: state }) =>
    readGameClothingIndex({
      gameRoot,
      stateDir: state,
      keysDirectory: (await provisionArchiveSupport({ stateDir: state }))
        .directory,
    }),
});

const listings = new Map();

/** Оглавление папки архива: имя файла → размер. Кэш на запуск Desktop. */
async function folderFiles({ gameRoot, archive, folder }, context, tools) {
  const key = `${gameRoot.toLowerCase()}|${archive}|${folder}`;
  if (listings.has(key)) return listings.get(key);
  const answer = await tools.list(
    { gameRoot, archive, filter: `${folder}/`, maxEntries: 20000 },
    context,
  );
  const files = new Map();
  for (const entry of answer?.entries || []) {
    const at = String(entry.path || "");
    if (!at.startsWith(`${folder}/`)) continue;
    const name = at.slice(folder.length + 1);
    if (name.includes("/")) continue;
    files.set(name, Number(entry.size) || 0);
  }
  listings.set(key, files);
  return files;
}

/*
 * Папка вещи из другого архива: оглавление по имени папки на любой
 * глубине вложенных архивов, файлы — только в ней самой.
 */
async function extraFiles({ gameRoot, archive, folder }, context, tools) {
  const key = `${gameRoot.toLowerCase()}|${archive}|*/${folder}`;
  if (listings.has(key)) return listings.get(key);
  const answer = await tools.list(
    { gameRoot, archive, filter: `${folder}/`, maxEntries: 4000 },
    context,
  );
  let at = null;
  const files = new Map();
  for (const entry of answer?.entries || []) {
    const entryPath = String(entry.path || "");
    const slash = entryPath.lastIndexOf("/");
    const directory = entryPath.slice(0, slash);
    if (directory !== folder && !directory.endsWith(`/${folder}`)) continue;
    if (at && directory !== at) continue;
    at = directory;
    files.set(entryPath.slice(slash + 1), Number(entry.size) || 0);
  }
  const found = { folder: at, files };
  listings.set(key, found);
  return found;
}

/* Вещи из других архивов игры: большая сумка GTA5RP у «Сумок». */
async function extraVariants(source, gameRoot, context, tools) {
  const out = [];
  for (const [index, extra] of (source.extras || []).entries()) {
    const found = await extraFiles(
      { gameRoot, archive: extra.archive, folder: extra.folder },
      context,
      tools,
    ).catch(() => null);
    if (!found?.folder) continue;
    const model = modelName(found.files, source.component, extra.drawable);
    if (!model) continue;
    const showcase = fullestStage(found.files, model);
    const textures = textureNames(
      found.files,
      source.component,
      extra.drawable,
    );
    out.push({
      variant: EXTRA_VARIANT + index,
      model,
      ...(showcase ? { showcase } : {}),
      texture: textures.largest,
      textures: textures.names,
      name: extra.name,
      /* Имя не из таблиц игры, а наше (проект в имени): окну — слова для перевода на язык интерфейса. */
      nameWords: extra.name,
      archive: extra.archive,
      folder: found.folder,
      file: `${extra.folder}/${source.component}_diff_${String(extra.drawable).padStart(3, "0")}_*.ytd`,
      replaces: extra.places.map((drawable) => ({
        server: extra.server,
        name: extra.serverName,
        folder: extra.folder,
        drawable,
        modelSuffix:
          modelName(found.files, source.component, drawable)?.match(
            /_([ur])\.ydd$/,
          )?.[1] || "u",
        textures: Math.max(
          1,
          textureNames(found.files, source.component, drawable).names.length,
        ),
      })),
    });
  }
  return out;
}

/*
 * Вещи из дополнений GTA Online (W4, Т-146; весь верх — ТЗ 04.10.2026,
 * задача 7). В базовой игре у свободного персонажа горсть вещей (восемь
 * масок, пятнадцать верхов), остальные — в `dlcpacks/*`: оглавление берётся
 * из магазинных файлов дополнений (`game-clothing-index.js`), имена — из
 * таблиц языка. Номер в «Моделях» у вещи постоянный: он живёт в сохранённых
 * работах, а список дополнений растёт с обновлениями игры — поэтому номера
 * выдаются по журналу в данных приложения (дополнение + номер вещи → номер),
 * и новое дополнение получает следующий свободный, а не сдвигает прежние.
 */
export const MASK_VARIANT_BASE = EXTRA_VARIANT + 100;

/*
 * Какие категории добирают вещи из дополнений и как называют безымянную.
 * Бронежилеты (задача 9): жилет фракций, тактический, тяжёлый и разгрузка
 * лежат в дополнениях — их и красят под цвет фракции.
 */
const DLC_SLOTS = Object.freeze({
  masks: { component: "berd", registry: "mask-variants", noun: "маска" },
  hair: { component: "hair", registry: "hair-variants", noun: "причёска" },
  tshirts: { component: "jbib", registry: "top-variants", noun: "верх" },
  armor: {
    component: "task",
    registry: "armor-variants",
    noun: "бронежилет",
    nameOf: armorItemName,
    wordsOf: armorItemWords,
  },
});

async function dlcNumbers(stateDir, gameRoot, keys, registry) {
  const file = path.join(
    stateDir,
    "clothing-index",
    `${registry}-${gameHash(gameRoot)}.json`,
  );
  const stored = await fs
    .readFile(file, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => null);
  const map = new Map(Object.entries(stored?.map || {}));
  let next = Number.isInteger(stored?.next) ? stored.next : MASK_VARIANT_BASE;
  let changed = false;
  const numbers = new Map();
  for (const key of keys) {
    if (!map.has(key)) {
      if (next > MAX_VARIANT) break;
      map.set(key, next);
      next += 1;
      changed = true;
    }
    numbers.set(key, map.get(key));
  }
  if (changed)
    await atomicWrite(
      file,
      Buffer.from(JSON.stringify({ next, map: Object.fromEntries(map) })),
    ).catch(() => {});
  return numbers;
}

const largestTexture = (files) =>
  [...files].sort((left, right) => right.size - left.size)[0]?.name || null;

/**
 * Вещи категории из дополнений как вещи «Моделей»; пусто, если игра не читается. Женские — со своим журналом номеров
 * (`<журнал>-female`): числа внутри журнала те же по счёту, смещение женских (`FEMALE_VARIANT`) накладывает `listGameClothing`.
 */
export async function dlcClothingVariants(slot, gameRoot, stateDir, resolved, gender = "male") {
  const spec = DLC_SLOTS[slot];
  if (!spec) return [];
  let index;
  try {
    index = await resolved.index({ gameRoot, stateDir });
  } catch {
    return [];
  }
  const items = componentItems(index, gender, spec.component);
  const keyOf = ({ collection, item }) => `${collection.pack}|${item.drawable}`;
  const numbers = await dlcNumbers(
    stateDir,
    gameRoot,
    items.map(keyOf),
    gender === "female" ? `${spec.registry}-female` : spec.registry,
  );
  const out = [];
  for (const entry of items) {
    const variant = numbers.get(keyOf(entry));
    if (!variant) continue;
    const { collection, item } = entry;
    const number = String(item.drawable).padStart(3, "0");
    const folder = item.dir.slice(item.dir.lastIndexOf("/") + 1);
    const known = spec.nameOf?.({ folder, drawable: item.drawable });
    /* Известный бронежилет без строки игры называется своими словами: окну — слова (по-русски, ключ словаря) и номер порознь, оно переводит их на язык интерфейса (17.11.2026). */
    const own = !item.name && known ? spec.wordsOf?.({ folder, drawable: item.drawable }) : null;
    const name =
      item.name ||
      (known && `${known} · ${collection.title}`) ||
      `${collection.title}: ${spec.noun} №${item.drawable}`;
    out.push({
      variant,
      model: item.model,
      ...(gender === "female" || spec.component === "hair" ? { modelSize: item.modelSize || 0 } : {}),
      texture: largestTexture(item.textureFiles),
      textures: item.textureFiles.map((file) => file.name),
      name,
      /* Строки игры по языкам (ru, en, de, fr, pl): окно называет вещь на языке интерфейса (`@modovik/clothing/game-names`), а `name` — русское, как было. Номер вещи и дополнение — для запасного названия там, где строки игры нет. */
      ...(item.names ? { names: { ...item.names } } : {}),
      ...(own ? { nameWords: own.words, ...(own.number === null ? {} : { nameNumber: own.number }) } : {}),
      /* Не `drawable`: у вещи это имя модели для движка («uppr_000_r», форма патрульного), и число в нём вело бы чтение вещи по другому пути (`buildGameModel`). */
      gameDrawable: item.drawable,
      shop: collection.title,
      /* Вещь из штатного подпакета (`dlc1.rpf`) читается оттуда, прочие — из `dlc.rpf` пака. */
      archive: item.archive || collection.archive,
      folder: item.dir,
      file: `${item.dir}/${spec.component}_diff_${number}_*.ytd`,
      /* Вещь из игры — вещь самой игры (без сервера): красят её и ставят на неё же. */
      replaces: [
        {
          server: null,
          name,
          folder,
          drawable: item.drawable,
          modelSuffix: item.model.match(/_([ur])\.ydd$/)?.[1] || "u",
          textures: Math.max(1, item.textures),
        },
      ],
    });
  }
  return out.sort((left, right) => left.variant - right.variant);
}

/** Маски дополнений (прежнее имя — его зовут тесты и Desktop). */
export const dlcMaskVariants = (gameRoot, stateDir, resolved) =>
  dlcClothingVariants("masks", gameRoot, stateDir, resolved);

/** Где лежат файлы вещи: у вещи из другого архива — там, у прочих — в папке категории. */
export const placeOfItem = (source, item) => ({
  ...source,
  archive: item?.archive || source.archive,
  folder: item?.folder || source.folder,
});

/**
 * Доп. модели вещи-источника в её папке игры (`hair_003_u_1.ydd`…): `Map(номер варианта → имя файла)`. Покраска кладёт в доп. модель цели вариант источника с тем же номером, иначе его основную модель
 * (правило заменёнки, `model-variants.js`). Вещи без вариантов, сбой чтения папки — пусто: тогда в доп. модели цели идёт основная модель источника, как раньше.
 */
export async function gameAlternateFiles({ gameRoot, place, item, component }, context, tools) {
  const model = String(item?.model || "");
  if (!model) return new Map();
  const drawable = Number(/_(\d{3})(?:_[ur])?\.ydd$/i.exec(model)?.[1]);
  if (!Number.isInteger(drawable)) return new Map();
  const suffix = /_([ur])\.ydd$/i.exec(model)?.[1]?.toLowerCase() || null;
  try {
    const files = await folderFiles({ gameRoot, archive: place.archive, folder: place.folder }, context, tools);
    return new Map(alternatesOf(files.keys(), component, drawable, suffix).map(({ name, number }) => [number, name]));
  } catch {
    return new Map();
  }
}

/*
 * Где лежат текстуры вещи. У вещи, чью модель Rockstar поправил заплаткой
 * (`patch2023_01_male.rpf`, `mppatches.rpf` — `mergePatchedItems`), модель
 * — в заплатке, а текстуры остались в исходном пакете.
 */
export const texturePlaceOf = (source, item) => {
  const place = placeOfItem(source, item);
  return item?.textureArchive || item?.textureFolder
    ? { ...place, archive: item.textureArchive || place.archive, folder: item.textureFolder || place.folder }
    : place;
};

const drawableOfModel = (model) => {
  const match = /_(\d{3})(?:_[ur])?\.ydd$/i.exec(String(model || ""));
  return match ? Number(match[1]) : null;
};

/*
 * Вещи, чью модель поправила заплатка Rockstar (фикс 5 ТЗ 07.10.2026).
 *
 * В оглавлении у такой вещи две записи: исходная — с текстурами, но часто с
 * моделью-пустышкой (один четырёхугольник в стороне от тела: в «Моделях» —
 * «квадратная картинка без модели»), и запись заплатки — с настоящей
 * моделью, но без текстур (вещь выходила серой, «багнутой»). Игра собирает
 * вещь так же: модель из заплатки, текстуры из исходного пакета. Здесь —
 * так же: одна вещь, номер исходной; номер заплатки — её псевдоним
 * (`aliasOf`, скрыт из списка): работа, сохранённая на нём, открывается.
 */
export function mergePatchedItems(entries, source) {
  const groups = new Map();
  for (const entry of entries) {
    const place = placeOfItem(source, entry);
    const drawable = drawableOfModel(entry.model);
    if (drawable === null || source.fixed) continue;
    const key = `${place.folder.split("/").pop().toLowerCase()}|${drawable}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const merged = new Map();
  const aliases = new Map();
  for (const group of groups.values()) {
    const origin = group.find((entry) => entry.textures?.length);
    const patches = group.filter((entry) => !entry.textures?.length);
    if (!origin || !patches.length) continue;
    const patch = patches[patches.length - 1];
    const texturePlace = placeOfItem(source, origin);
    const patchPlace = placeOfItem(source, patch);
    const whole = {
      ...origin,
      model: patch.model,
      ...(patch.modelSize ? { modelSize: patch.modelSize } : {}),
      archive: patchPlace.archive,
      folder: patchPlace.folder,
      textureArchive: texturePlace.archive,
      textureFolder: texturePlace.folder,
      patched: true,
    };
    delete whole.showcase;
    merged.set(origin, whole);
    for (const alias of patches) aliases.set(alias, { ...whole, variant: alias.variant, aliasOf: origin.variant, hidden: true });
  }
  return entries.map((entry) => merged.get(entry) || aliases.get(entry) || entry);
}

/*
 * Опись вещей игры (`resources/clothing/game-shapes.json`, `npm run
 * clothing:census`): пустышки и крой по файлу модели. Пустышки — модель из
 * одного четырёхугольника — в «Модели» не идут. Чего в описи нет (вещь из
 * нового обновления игры), узнаётся при чтении модели и помнится здесь же.
 */
let shapesPromise = null;
export function readGameShapes() {
  if (!shapesPromise)
    shapesPromise = (async () => {
      const candidates = [
        process.env.ASTRAL_CLOTHING_RESOURCES && path.join(process.env.ASTRAL_CLOTHING_RESOURCES, "game-shapes.json"),
        process.resourcesPath && path.join(process.resourcesPath, "clothing", "game-shapes.json"),
        path.resolve(moduleDirectory, "../../../resources/clothing/game-shapes.json"),
      ].filter(Boolean);
      for (const candidate of candidates) {
        try {
          const parsed = JSON.parse(await fs.readFile(candidate, "utf8"));
          if (parsed?.items && typeof parsed.items === "object") return parsed.items;
        } catch {
          /* нет описи — пустышки узнаются при чтении модели */
        }
      }
      return {};
    })();
  return shapesPromise;
}

/*
 * Одинаковые вещи игры (`resources/clothing/game-looks.json`, `npm run clothing:looks`, круг 7): таблица групп — одна плитка на группу (`@modovik/clothing/game-looks`). Нет таблицы — группировки нет,
 * окно показывает вещи как есть: вещь из нового обновления игры, которой в таблице нет, остаётся своей плиткой.
 */
let looksPromise = null;
export function readGameLooks() {
  if (!looksPromise)
    looksPromise = (async () => {
      const candidates = [
        process.env.ASTRAL_CLOTHING_RESOURCES && path.join(process.env.ASTRAL_CLOTHING_RESOURCES, "game-looks.json"),
        process.resourcesPath && path.join(process.resourcesPath, "clothing", "game-looks.json"),
        path.resolve(moduleDirectory, "../../../resources/clothing/game-looks.json"),
      ].filter(Boolean);
      for (const candidate of candidates) {
        try {
          const parsed = JSON.parse(await fs.readFile(candidate, "utf8"));
          if (Array.isArray(parsed?.groups)) return parsed;
        } catch {
          /* нет таблицы — вещи без группировки */
        }
      }
      return null;
    })();
  return looksPromise;
}

/*
 * Крой вещей игры по описи — для «Замены»: `component|папка|номер` →
 * `{ sleeve, hood }` (только мужской персонаж и только то, что известно).
 */
export async function gameShapeIndex(shapes = null) {
  const items = shapes || (await readGameShapes());
  const index = new Map();
  for (const [key, shape] of Object.entries(items)) {
    if (!shape?.sleeve) continue;
    const file = key.slice(key.indexOf(":") + 1).split("/");
    const model = file.pop() || "";
    const folder = (file.pop() || "").toLowerCase();
    const match = /^([a-z_]+?)_(\d{3})(?:_[ur])?\.ydd$/i.exec(model);
    if (!match || !folder) continue;
    index.set(`${match[1].toLowerCase()}|${folder}|${Number(match[2])}`, { sleeve: shape.sleeve, hood: Boolean(shape.hood) });
  }
  return index;
}

const runtimePlaceholders = new Set();
const shapeKeyOf = (place, model) => `${place.archive}:${place.folder}/${model}`.toLowerCase();

/**
 * Не вещь для «Моделей» (фикс 5 ТЗ 07.10.2026):
 *   • пустышка — по описи `shapes` или по уже прочитанной модели;
 *   • текстур нет нигде (у части вещей, поправленных заплаткой, мужских
 *     текстур нет ни в исходном пакете, ни в заплатках): ни показать «как
 *     в магазине», ни покрасить;
 *   • все расцветки — шахматка-заглушка (по описи).
 */
export function isPlaceholderItem(source, item, shapes = {}) {
  if (!source.fixed && !item?.textures?.length && !item?.texture) return true;
  /* Женские вещи в описи (`game-shapes.json`) не значатся: пустышку выдаёт размер файла модели — полкилобайта против сотен. */
  /* Причёски — и мужские тоже (14.11.2026): «лысая» причёска без прядей — пустышка в полкилобайта, вещью она не показывается. */
  if ((folderGender(placeOfItem(source, item).folder) === "female" || source.component === "hair") && item?.modelSize > 0 && item.modelSize < BLANK_MODEL_BYTES && !item?.patched)
    return true;
  const key = shapeKeyOf(placeOfItem(source, item), item?.showcase || item?.model);
  if (runtimePlaceholders.has(key)) return true;
  const known = shapes[key];
  if (known?.textureProblem) return true;
  return !item?.patched && Boolean(known?.placeholder);
}

/* Отметить пустышку, узнанную при чтении модели. */
function rememberPlaceholder(source, item) {
  runtimePlaceholders.add(shapeKeyOf(placeOfItem(source, item), item?.showcase || item?.model));
}

/* Капюшон на голове: верх модели выше макушки персонажа (замер по описи —
   0,85–0,86 м против 0,61–0,67 у той же вещи с капюшоном на спине). */
const HOOD_UP_TOP = 0.8;

/*
 * Одноимённые вещи (фикс 5 ТЗ 07.10.2026). У магазина игры одна вещь бывает
 * несколькими моделями под одним именем: с капюшоном на голове и на спине,
 * распахнутая и застёгнутая. В «Моделях» они различаются подписью; имя для
 * сервера (`replaces`) остаётся магазинным.
 */
export function distinguishSameNames(variants, source, shapes = {}) {
  const groups = new Map();
  for (const item of variants) {
    if (item.hidden || !item.name) continue;
    if (!groups.has(item.name)) groups.set(item.name, []);
    groups.get(item.name).push(item);
  }
  const renamed = new Map();
  for (const [name, items] of groups) {
    if (items.length < 2) continue;
    items.forEach((item, index) => {
      const shape = shapes[shapeKeyOf(placeOfItem(source, item), item.showcase || item.model)];
      const hoodUp = Boolean(shape?.hood) && shape.top > HOOD_UP_TOP;
      /* Подпись по-русски (как была) и её разбор: окно на другом языке допишет к названию игры свои слова («вид 2», «капюшон надет»). */
      const suffix = hoodUp ? { hood: true } : { view: index + 1 };
      renamed.set(item, { name: `${name} · ${hoodUp ? "капюшон надет" : `вид ${index + 1}`}`, suffix });
    });
  }
  return renamed.size
    ? variants.map((item) => (renamed.has(item) ? { ...item, name: renamed.get(item).name, nameSuffix: renamed.get(item).suffix } : item))
    : variants;
}

/**
 * Вещи категории в игре игрока: номер, файл модели и её текстура.
 * Номера идут подряд, как в игре, — «Маска №12» в Astral та же, что №12 у
 * персонажа в магазине одежды.
 */
export async function listGameClothing(input, context, stateDir, tools = {}) {
  /* Пол вещей: женские стоят в тех же архивах, в папке женского персонажа, и числа у них смещены (`FEMALE_VARIANT`). */
  const gender = requestGender(input);
  const source = clothingSource(input?.slot, gender);
  const gameRoot = clothingGameRoot(input);
  /* Форма патрульного — одна мужская вещь; у женского персонажа её в этом наборе нет. */
  if (source.fixed) return { slot: input.slot, variants: gender === "female" ? [] : [...source.fixed] };
  const resolved = { ...clothingArchiveTools(stateDir), ...tools };
  const files = await folderFiles(
    { gameRoot, archive: source.archive, folder: source.folder },
    context,
    resolved,
  );
  const numbers = new Set();
  const pattern = new RegExp(`^${source.component}_(\\d{3})(?:_[ur])?\\.ydd$`);
  for (const name of files.keys()) {
    const match = pattern.exec(name);
    if (match) numbers.add(Number(match[1]));
  }
  const variants = [...numbers]
    .sort((left, right) => left - right)
    .slice(0, MAX_CLOTHING_VARIANTS)
    .map((variant) => {
      const textures = textureNames(files, source.component, variant);
      const model = modelName(files, source.component, variant);
      return {
        variant,
        model,
        /* Размер файла модели нужен женским вещам: их в описи нет, пустышку выдаёт он. */
        ...(model && (gender === "female" || source.component === "hair") ? { modelSize: files.get(model) || 0 } : {}),
        texture: textures.largest,
        textures: textures.names,
      };
    })
    .filter((item) => item.model);
  /* Вещи из других архивов — первыми: их ради этого и добавляли, а за
     «Показать ещё» после сотни сумок-парашютов их бы не нашли. Вещи,
     поправленные заплаткой Rockstar, — одной записью (модель заплатки,
     текстуры исходного пакета); пустышки — не вещи. */
  const all = mergePatchedItems(
    [
      ...(await extraVariants(source, gameRoot, context, resolved)),
      ...(await dlcClothingVariants(input.slot, gameRoot, stateDir, resolved, gender)),
      ...variants,
    ],
    source,
  );
  const shapes = (await resolved.shapes?.().catch(() => null)) || {};
  const listed = distinguishSameNames(
    all.filter((item) => !isPlaceholderItem(source, item, shapes)),
    source,
    shapes,
  );
  return {
    slot: input.slot,
    variants: gender === "female" ? listed.map(femaleItem) : listed,
  };
}

/** Женская вещь «Моделей»: число со смещением (и число псевдонима заплатки), пол — в записи. */
const femaleItem = (item) => ({
  ...item,
  gender: "female",
  variant: withGender(item.variant, "female"),
  ...(Number.isInteger(item.aliasOf) ? { aliasOf: withGender(item.aliasOf, "female") } : {}),
});

const asArrayBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

export async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes);
  /* Два вызова одного ключа (3D и цветная модель, повтор окна) пишут один файл: на Windows подмена занятого файла отказывает — повторяется. */
  await renameWithRetry(temporary, file).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  });
}

const choices = new Map();
/* Сколько расцветок перебрать в поисках лица вещи: дальше — запасной выбор.
   Все буквы (фикс 5 ТЗ 07.10.2026): у части вещей игры первые шесть —
   шахматка-заглушка, и вещь показывалась «багнутой». */
const MAX_PICKS = 26;

/*
 * Лица вещей на диске (02.11.2026, владелец: «некоторая одежда почему-то всё равно долго одевается»; стенд `scripts/perf/baseline/wear-dress-sweep.mjs`).
 * У вещей, где первые буквы — шахматка-заглушка (штаны, обувь, кепки игры: 16 расцветок, лицо — пятая–четырнадцатая), выбор лица читал и разбирал до 14 текстур
 * подряд — 80–180 мс при ×1 на первый щелчок по вещи, у слабого ПК втрое. Выбирают его три потока порознь (плитки полки — главный процесс, персонаж — поток читателя,
 * расцветки — поток списка), и каждый платил сам; на следующем запуске — снова. Теперь выбор один на установку: файл `texture-faces.v1.json` в папке моделей игры,
 * запись — имя лица и список расцветок, по которым оно выбрано (другой список — игра обновилась — выбор заново). Ответ тот же, что у перебора: первая настоящая по буквам.
 * В файл идёт только выбор, где каждая расцветка прочиталась: сбой чтения не закрепляет запасной выбор навсегда.
 */
const FACES_FILE = "texture-faces.v1.json";
const faceStores = new Map();
const faceWrites = new Map();
const facesFileOf = (stateDir, gameRoot) => (stateDir && gameRoot ? path.join(stateDir, "clothing-models", gameHash(gameRoot), FACES_FILE) : null);
const facesListOf = (item) => (item?.textures || []).slice(0, MAX_PICKS).join(",");
const faceKeyOf = (source, item) => `${source.folder}|${item.model}`;

async function readFaces(file) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return null;
  const known = faceStores.get(file);
  if (known?.at === stat.mtimeMs) return known.faces;
  const parsed = await fs
    .readFile(file, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => null);
  const faces = parsed && typeof parsed.faces === "object" && parsed.faces ? parsed.faces : {};
  faceStores.set(file, { at: stat.mtimeMs, faces });
  return faces;
}

/** Лицо вещи, выбранное раньше (этим или другим потоком, в прошлый запуск); `null` — не выбирали или список расцветок уже другой. */
async function storedFace(stateDir, gameRoot, source, item) {
  const file = facesFileOf(stateDir, gameRoot);
  if (!file) return null;
  const known = (await readFaces(file))?.[faceKeyOf(source, item)];
  if (!known || known.of !== facesListOf(item)) return null;
  return known.name === item.texture || (item.textures || []).includes(known.name) ? known.name : null;
}

/**
 * Запомнить лицо на диске; записи одного файла идут по очереди и сливаются с тем, что записали другие потоки. Вызывающий ждёт записи (1–3 мс, только после
 * настоящего перебора): иначе уборка папки состояния сразу после ответа (тесты, сброс кэша) встречала бы недописанный файл (ENOTEMPTY).
 */
export function rememberFace(stateDir, gameRoot, source, item, name) {
  const file = facesFileOf(stateDir, gameRoot);
  if (!file || !name) return Promise.resolve();
  const previous = faceWrites.get(file) || Promise.resolve();
  const writing = previous
    .then(async () => {
      const known = (await readFaces(file)) || {};
      const entry = known[faceKeyOf(source, item)];
      if (entry?.name === name && entry.of === facesListOf(item)) return;
      const faces = { ...known, [faceKeyOf(source, item)]: { name, of: facesListOf(item) } };
      await atomicWrite(file, Buffer.from(JSON.stringify({ version: 1, faces })));
      faceStores.delete(file);
    })
    .catch(() => {});
  faceWrites.set(file, writing);
  void writing.then(() => {
    if (faceWrites.get(file) === writing) faceWrites.delete(file);
  });
  return writing;
}

/** Записи лиц на диск закончены (тесты и стенд смотрят на файл). */
export const facesWritten = () => Promise.all([...faceWrites.values()]);
/** Для тестов: забыть выборы лиц в памяти (файл на диске остаётся). */
export const forgetFaceChoices = () => {
  choices.clear();
  faceStores.clear();
};

/**
 * Лицо вещи из игры — первая по буквам расцветка, которая не заглушка.
 * Выбор запоминается на запуск Desktop: «Вид», покраска в игру и «На что
 * поставить» берут одну и ту же текстуру — иначе красили бы одну, а в игру
 * пекли другую. Нечитаемая расцветка пропускается; не нашлось — крупнейшая.
 */
export async function chooseGameTexture(
  { gameRoot, source, item, stateDir = null },
  context,
  resolved,
  work,
) {
  const key = `${gameRoot.toLowerCase()}|${source.folder}|${item.model}`;
  if (choices.has(key)) return choices.get(key);
  const stored = await storedFace(stateDir, gameRoot, source, item).catch(() => null);
  if (stored) {
    choices.set(key, stored);
    return stored;
  }
  const prefix = source.archive.replace(/\.rpf$/i, "");
  let chosen = item.texture;
  let complete = true;
  for (const name of (item.textures || []).slice(0, MAX_PICKS)) {
    const output = path.join(work, "pick", name);
    try {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await resolved.read(
        { gameRoot, entry: `${prefix}:/${source.folder}/${name}`, output },
        context,
      );
      const picture = (resolved.colourPicture || colourPicture)(
        await fs.readFile(output),
        { inflateRaw: inflateRawNode, maxSize: 64 },
      );
      if (!isStubPicture(picture)) {
        chosen = name;
        break;
      }
    } catch {
      /* нечитаемая расцветка — смотрим следующую */
      complete = false;
    }
  }
  choices.set(key, chosen);
  if (complete) await rememberFace(stateDir, gameRoot, source, item, chosen);
  return chosen;
}

/**
 * Расцветка вещи игры по номеру (`texture` у запроса, 30.10.2026, «варианты у вещей игры»): номер — место текстуры в `item.textures` (имена файлов `<вид>_diff_NNN_<буква>_…`
 * по порядку), как у игры индекс текстуры. Нет номера или такой нет у вещи — `null`, тогда вещь берёт своё лицо (`chooseGameTexture`).
 */
export const textureIndexOf = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < MAX_PICKS ? number : null;
};
export const textureByIndex = (item, index) => (index === null ? null : item?.textures?.[index] || null);

const textureReports = new Map();

/**
 * Какие расцветки у вещи игры настоящие: `{ slot, variant, textures: [{ index, name }] }` без шахматок-заглушек (`isStubPicture`) — выбор такой
 * расцветки показал бы на персонаже брак. Читаются и разбираются по одной (до `MAX_PICKS`), ответ держится на запуск Desktop.
 */
export async function readGameTextureList(input, context, stateDir, tools = {}) {
  const variant = Number(input?.variant);
  if (!validVariant(variant)) throw refusal("CLOTHING_VARIANT", "Такой вещи в игре нет.");
  const gender = variantGender(variant);
  const source = clothingSource(input?.slot, gender);
  const gameRoot = clothingGameRoot(input);
  if (source.fixed) return { slot: input.slot, variant, textures: [] };
  const key = `${gameRoot.toLowerCase()}|${input.slot}|${variant}`;
  if (textureReports.has(key)) return { slot: input.slot, variant, textures: textureReports.get(key) };
  const resolved = { ...clothingArchiveTools(stateDir), ...tools };
  const { variants } = await listGameClothing({ gameRoot, slot: input.slot, gender }, context, stateDir, resolved);
  const item = variants.find((entry) => entry.variant === variant);
  if (!item) throw refusal("CLOTHING_VARIANT", "Такой вещи в игре нет.");
  const place = texturePlaceOf(source, item);
  const prefix = place.archive.replace(/\.rpf$/i, "");
  const work = path.join(stateDir, "clothing-models", "work", randomUUID());
  const real = [];
  let complete = true;
  try {
    for (const [index, name] of (item.textures || []).slice(0, MAX_PICKS).entries()) {
      const output = path.join(work, "pick", name);
      try {
        await fs.mkdir(path.dirname(output), { recursive: true });
        await resolved.read({ gameRoot, entry: `${prefix}:/${place.folder}/${name}`, output }, context);
        const picture = (resolved.colourPicture || colourPicture)(await fs.readFile(output), { inflateRaw: inflateRawNode, maxSize: 64 });
        if (!isStubPicture(picture)) real.push({ index, name });
      } catch {
        /* нечитаемая расцветка — в список не идёт */
        complete = false;
      }
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  textureReports.set(key, real);
  /* Лицо вещи — первая настоящая: тот же ответ, что дал бы `chooseGameTexture`, и он уже есть — персонажу и плиткам перебирать незачем. */
  if (complete) {
    const face = real[0]?.name || item.texture;
    if (face) {
      choices.set(`${gameRoot.toLowerCase()}|${place.folder}|${item.model}`, face);
      await rememberFace(stateDir, gameRoot, place, item, face);
    }
  }
  return { slot: input.slot, variant, textures: real };
}

/** Забыть ответы о расцветках — для тестов. */
export const forgetTextureReports = () => textureReports.clear();

/*
 * Версия сборки в имени кэша: GLB прежней сборки (нативной, с крупнейшей
 * текстурой) показывали шахматку, сумки js2 — лямками к зрителю, кепки js3 —
 * козырьком от зрителя, js4 — перчатки ребром и пустую «Большую сумку»
 * (квадрат вместо ступени наполнения), js5 — размытую шахматку-заглушку
 * вместо расцветки (кепка №10, кеды №0), и оставались бы в кэше навсегда.
 */
/* js7 — вещи с моделью из заплатки Rockstar (текстуры — из исходного пакета).
   js8 — листы нормалей BC5 у вещей нативной сборки декодируются верно
   (12.10.2026): прежний декодер CodeWalker писал зелёный в красный. */
const MODEL_BUILD = "js8";

/** Модель одной вещи из игры в GLB — из кэша или собранная заново. */
export async function readGameClothingModel(
  input,
  context,
  stateDir,
  tools = {},
) {
  /* `textureList` — какие расцветки у вещи настоящие (панель «Надето» показывает по ним варианты), тем же каналом: GLB не строится. */
  if (input?.textureList) return readGameTextureList(input, context, stateDir, tools);
  const variant = Number(input?.variant);
  if (!validVariant(variant)) throw refusal("CLOTHING_VARIANT", "Такой вещи в игре нет.");
  const gender = variantGender(variant);
  const source = clothingSource(input?.slot, gender);
  const gameRoot = clothingGameRoot(input);
  /* Расцветка по номеру (`texture`): у каждой своя модель в кэше — GLB с первой настоящей расцветкой имени без номера не меняется. */
  const textureIndex = source.fixed ? null : textureIndexOf(input?.texture);
  const cached = path.join(
    stateDir,
    "clothing-models",
    gameHash(gameRoot),
    `${input.slot}-${variant}${textureIndex === null ? "" : `-t${textureIndex}`}.${MODEL_BUILD}.glb`,
  );
  let bytes = await fs.readFile(cached).catch(() => null);
  /* Крой вещи (рукав, капюшон) — рядом с моделью в кэше: «Замена» по нему
     не предлагает вещи другого кроя (фикс 5 ТЗ 07.10.2026). */
  const shapeFile = `${cached}.shape.json`;
  let shape = bytes ? await fs.readFile(shapeFile, "utf8").then(JSON.parse).catch(() => null) : null;
  if (!bytes) {
    const resolved = { ...clothingArchiveTools(stateDir), ...tools };
    const { variants } = await listGameClothing(
      { gameRoot, slot: input.slot, gender },
      context,
      stateDir,
      resolved,
    );
    const item = variants.find((entry) => entry.variant === variant);
    if (!item) throw refusal("CLOTHING_VARIANT", "Такой вещи в игре нет.");
    const place = placeOfItem(source, item);
    const texturePlace = texturePlaceOf(source, item);
    const work = path.join(stateDir, "clothing-models", "work", randomUUID());
    const prefix = place.archive.replace(/\.rpf$/i, "");
    const texturePrefix = texturePlace.archive.replace(/\.rpf$/i, "");
    try {
      await fs.mkdir(work, { recursive: true });
      const modelFile = path.join(work, "item.ydd");
      await resolved.read(
        {
          gameRoot,
          entry: `${prefix}:/${place.folder}/${item.showcase || item.model}`,
          output: modelFile,
        },
        context,
      );
      /* Пустышка игры (один четырёхугольник в стороне от тела) — не вещь:
         в «Моделях» она была «квадратной картинкой без модели». */
      if (!item.drawable) {
        try {
          shape = garmentShape(clothingDrawable(await fs.readFile(modelFile), { inflateRaw: inflateRawNode }), source.component);
        } catch {
          shape = null;
        }
        if (shape?.placeholder && !item.patched) {
          rememberPlaceholder(source, item);
          throw refusal("CLOTHING_PLACEHOLDER", "У этой вещи в игре нет модели — только место под неё. Выбери другую.");
        }
      }
      const texture = source.fixed
        ? item.texture
        : textureByIndex(item, textureIndex) ||
          (await chooseGameTexture(
            { gameRoot, source: texturePlace, item, stateDir },
            context,
            resolved,
            work,
          ));
      const textureFile = path.join(work, "item.ytd");
      const hasTexture = texture
        ? await resolved
            .read(
              {
                gameRoot,
                entry: `${texturePrefix}:/${texturePlace.folder}/${texture}`,
                output: textureFile,
              },
              context,
            )
            .then(() => true)
            /* Без текстуры вещь откроется серой — красить её это не мешает. */
            .catch(() => false)
        : false;
      bytes = await buildGameModel(
        {
          modelFile,
          textureFile: hasTexture ? textureFile : null,
          item,
          component: source.component,
          slot: input.slot,
        },
        { work, resolved, context },
      );
      await atomicWrite(cached, bytes);
      if (shape?.sleeve) await atomicWrite(shapeFile, Buffer.from(JSON.stringify({ sleeve: shape.sleeve, hood: Boolean(shape.hood) }))).catch(() => {});
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (bytes.length > MAX_MODEL_BYTES)
    throw refusal(
      "CLOTHING_MODEL_LARGE",
      "Модель слишком велика для редактора.",
    );
  return {
    slot: input.slot,
    variant,
    size: bytes.length,
    bytes: asArrayBuffer(bytes),
    ...(shape?.sleeve ? { shape: { sleeve: shape.sleeve, hood: Boolean(shape.hood) } } : {}),
  };
}

/*
 * GLB вещи: сборка на JS (`@modovik/clothing/model`) — та же, что у модели
 * витрины каталога. Модель, которую JS не читает (форма патрульного — модель
 * полицейского целиком), собирает нативный движок, как раньше.
 */
async function buildGameModel(
  { modelFile, textureFile, item, component, slot },
  { work, resolved, context },
) {
  if (!item.drawable)
    try {
      const drawable = showcaseDrawable(
        clothingDrawable(await fs.readFile(modelFile), {
          inflateRaw: inflateRawNode,
        }),
        component,
        { slot },
      );
      if (drawable?.meshes.length) {
        const picture = textureFile
          ? colourPicture(await fs.readFile(textureFile), {
              inflateRaw: inflateRawNode,
            })
          : null;
        return Buffer.from(await clothingModelGlb(drawable, picture, { encodePng: encodePngFast }));
      }
    } catch {
      /* не прочлось на JS — нативный движок ниже */
    }
  const output = path.join(work, "item.glb");
  await resolved.native(
    "convert-model",
    {
      input: modelFile,
      output,
      textures: textureFile ? [textureFile] : [],
      ...(item.drawable ? { drawable: item.drawable } : {}),
    },
    context,
  );
  return fs.readFile(output);
}

/*
 * Какой файл пакета — модель вещи. В пакете одежды бывают обе фигуры
 * персонажа; мастерская берёт мужскую — на неё и одета витрина каталога.
 */
export function pickPackageModel(files) {
  const models = files.filter((file) => /\.ydd$/i.test(file));
  return (
    /* Мужская — по имени файла (`mp_m_freemode_01^jbib_005_u.ydd`) или по папке пакета (`payload/mp_m_freemode_01/jbib_005_u.ydd`): у пакета с двумя фигурами первым в манифесте бывает женский файл. */
    models.find((file) => /mp_m_freemode_01/i.test(file)) ||
    models[0] ||
    null
  );
}

/* Все текстуры той же вещи: `…^jbib_005_u.ydd` → `…^jbib_diff_005_*.ytd`; нет своих по имени — все `.ytd` пакета. */
function ownTextures(files, model) {
  /* Перекраска штатной вещи: в пакете нет модели, расцветки — все `.ytd` пакета. */
  if (!model) return files.filter((file) => /\.ytd$/i.test(file));
  const stem = path.basename(model).replace(/\.ydd$/i, "");
  const match = /^(.*?)([a-z_]+)_(\d{3})(?:_[ur])?$/i.exec(stem);
  const all = files.filter((file) => /\.ytd$/i.test(file));
  if (!match) return all;
  const [, owner, component, number] = match;
  const own = all.filter((file) =>
    path
      .basename(file)
      .toLowerCase()
      .startsWith(`${owner}${component}_diff_${number}_`.toLowerCase()),
  );
  return own.length ? own : all;
}

/* Текстуры той же вещи: первые четыре (лицо вещи — первая расцветка, что не заглушка). */
export function pickPackageTextures(files, model) {
  return ownTextures(files, model).slice(0, 4);
}

/*
 * Текстуры по буквам расцветок (`…_diff_005_c_uni.ytd` → `c`; 28.10.2026, владелец: «3D должно показывать именно выбранную расцветку»):
 * на букву берётся первый файл. Вещь без буквы в имени (одна текстура) даёт пустой список.
 */
export function packageColourTextures(files, model) {
  const colours = new Map();
  for (const file of ownTextures(files, model)) {
    const letter = /_diff_\d{3}_([a-z])(?:_[a-z]{3})?\.ytd$/i.exec(path.basename(file))?.[1]?.toLowerCase();
    if (letter && !colours.has(letter)) colours.set(letter, file);
  }
  return colours;
}

/*
 * Компонент вещи по имени её файла: `…^jbib_005_u.ydd` → `jbib`,
 * `p_head_002.ydd` → `p_head`. По нему показ решает, как поставить вещь.
 */
export function componentOfModelFile(file) {
  const stem = path
    .basename(String(file || ""))
    .replace(/\.ydd$/i, "")
    .replace(/^.*\^/, "");
  const match = /^((?:p_)?[a-z]+)_\d{3}(?:_[ur])?(?:_\d{1,2})?$/i.exec(stem);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Файлы вещи каталога: подписанный пакет скачивается тем же путём, что и
 * установка. `{ model, textures }` — мужская модель и её расцветки.
 */
/*
 * Что из пакета нужно, чтобы показать вещь одного цвета (28.10.2026, живая проверка: «3D» на холодном пакете в 20 МБ — 25 с, а нужны модель и текстуры цвета, ~4 МБ):
 * модель, файл выбранного цвета и первая текстура (лицо вещи, если цвет — заглушка). Цвет не назван — модель и первые четыре, как прежде. Нет модели в манифесте — пакет целиком.
 */
export function neededPackageFiles(manifest, colour = "") {
  const sources = (manifest?.files || []).filter((file) => file?.source && file.action !== "delete").map((file) => file.source);
  const model = pickPackageModel(sources);
  if (!model) return null;
  const letter = /^[a-z]$/.test(String(colour || "")) ? String(colour) : "";
  const faces = pickPackageTextures(sources, model);
  const picked = letter ? [packageColourTextures(sources, model).get(letter), faces[0]] : faces;
  const wanted = new Set([model, ...picked.filter(Boolean)]);
  return (file) => wanted.has(file.source);
}

/*
 * Сначала — только то, без чего вещь не показать (16.11.2026, «смена вещи каталога на персонаже ~5 с»): модель и одна текстура — выбранная расцветка или лицо вещи.
 * Остальные расцветки (без выбора — ещё три, по 1,5–2 МБ каждая) нужны, только если эта текстура заглушка: их догружает `catalogMoreFiles`, а не каждый щелчок.
 * Вещь без текстур в манифесте — одна модель.
 */
export function firstPackageFiles(manifest, colour = "") {
  const sources = (manifest?.files || []).filter((file) => file?.source && file.action !== "delete").map((file) => file.source);
  const model = pickPackageModel(sources);
  if (!model) return null;
  const letter = /^[a-z]$/.test(String(colour || "")) ? String(colour) : "";
  const faces = pickPackageTextures(sources, model);
  const first = (letter && packageColourTextures(sources, model).get(letter)) || faces[0];
  const wanted = new Set([model, first].filter(Boolean));
  return (file) => wanted.has(file.source);
}

/* Скачивание пакета — по одному за раз на пакет: окно просит 3D персонажа и цветную модель вещи одновременно, а нужны им одни и те же файлы. Второй вызов
   ждёт первого и находит файлы на диске, вместо того чтобы качать их второй раз в те же временные имена. */
const downloadTurns = new Map();
async function inDownloadTurn(key, run) {
  const turn = (downloadTurns.get(key) || Promise.resolve()).catch(() => {}).then(run);
  downloadTurns.set(key, turn);
  try {
    return await turn;
  } finally {
    if (downloadTurns.get(key) === turn) downloadTurns.delete(key);
  }
}

export async function catalogClothingFiles(input, context, deps, { textureOnly = false, first = false } = {}) {
  const manifest = input?.manifest;
  const id = String(manifest?.id || "");
  const version = String(manifest?.version || "");
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id) || !version)
    throw refusal("CLOTHING_CATALOG", "У вещи каталога нет пакета.");
  const resolved = {
    ...clothingArchiveTools(deps.stateDir),
    ...(deps.tools || {}),
  };
  const all = neededPackageFiles(manifest, input?.colour);
  /* `first` — персонаж: сначала модель и одна текстура, остальное — `catalogMoreFiles`, если первая оказалась заглушкой. */
  const firstFiles = first && all ? firstPackageFiles(manifest, input?.colour) : null;
  const only = firstFiles || all;
  const downloaded = await inDownloadTurn(`${id}@${version}`, () => downloadPackageFiles(input, deps, resolved, context, only));
  const files = (downloaded?.manifest?.files || manifest.files || [])
    .filter((file) => file?.source && file.action !== "delete")
    .map((file) => path.resolve(downloaded.packageRoot, file.source))
    .filter((file) =>
      file.startsWith(path.resolve(downloaded.packageRoot) + path.sep),
    );
  const model = pickPackageModel(files);
  /* Перекраска штатной вещи несёт одни расцветки — модель у неё в игре (`catalog-retexture-model.js`): тот, кто готов взять её там, просит `textureOnly`. */
  if (!model && textureOnly && files.some((file) => /\.ytd$/i.test(file)))
    return { id, version, model: null, textures: pickPackageTextures(files, null), colours: packageColourTextures(files, null) };
  if (!model)
    throw refusal(
      "CLOTHING_CATALOG_MODEL",
      "В пакете этой вещи нет модели одежды: в нём только текстуры. Такую вещь в мастерской не открыть.",
    );
  return {
    id,
    version,
    model,
    textures: pickPackageTextures(files, model),
    colours: packageColourTextures(files, model),
    /* Есть ли что докачать: первая очередь взяла не всё нужное (`first`). */
    more: Boolean(firstFiles && all && (manifest.files || []).some((file) => file?.source && file.action !== "delete" && all(file) && !firstFiles(file))),
  };
}

/* Скачивание файлов пакета: подписанный манифест, свои линии, готовые файлы на диске не качаются заново. */
function downloadPackageFiles(input, deps, resolved, context, only) {
  return resolved.download({
    manifest: input.manifest,
    baseUrl: String(input?.baseUrl || ""),
    ...(only ? { only, downloadLanes: () => 3 } : {}),
    publicKey: deps.publicKey,
    stateDir: deps.stateDir,
    downloadsDir: deps.downloadsDir || null,
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
    onProgress: context?.onProgress || null,
  });
}

/** Остальные файлы вещи (расцветки), когда первая текстура оказалась заглушкой: те, что уже лежат на диске, не качаются. */
export function catalogMoreFiles(input, context, deps) {
  const resolved = { ...clothingArchiveTools(deps.stateDir), ...(deps.tools || {}) };
  const manifest = input?.manifest;
  const only = neededPackageFiles(manifest, input?.colour);
  return inDownloadTurn(`${manifest?.id}@${manifest?.version}`, () => downloadPackageFiles(input, deps, resolved, context, only));
}

/* Лицо вещи каталога — первая расцветка, которая не заглушка. */
export async function catalogPicture(textures) {
  for (const texture of textures || [])
    try {
      const picture = colourPicture(await fs.readFile(texture), {
        inflateRaw: inflateRawNode,
      });
      if (!isStubPicture(picture)) return picture;
    } catch {
      /* нечитаемая расцветка — следующая */
    }
  return null;
}

/*
 * Версия сборки вещей каталога: js1 — та же JS-сборка с показом, что у
 * вещей игры (кепка козырьком к зрителю, перчатки парой). Прежние GLB
 * нативного конвертера показывали вещь как в файле. js2 — листы нормалей BC5
 * у вещей нативной сборки декодируются верно (12.10.2026).
 */
const CATALOG_BUILD = "js2";

/* Разобранные модели каталога в памяти Desktop: вещь и показ → `{ shape, drawable }`. */
const parsedCatalogModels = new Map();
const PARSED_LIMIT = 8;

/**
 * Модель вещи из каталога: скачать подписанный пакет, собрать модель из его
 * `.ydd`/`.ytd` той же JS-сборкой с показом, что у вещей игры (`slot` —
 * категория: перчаткам нужна пара). Не прочлось на JS — нативный движок, как
 * раньше. Кэш — по моду, версии и категории.
 */
export async function readCatalogClothingModel(input, context, deps) {
  const manifest = input?.manifest;
  const id = String(manifest?.id || "");
  const version = String(manifest?.version || "");
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id) || !version)
    throw refusal("CLOTHING_CATALOG", "У вещи каталога нет пакета.");
  const slot = /^[a-z-]{1,32}$/.test(String(input?.slot || ""))
    ? String(input.slot)
    : "";
  /* Расцветка (буква пакета): 3D вещи и баннер «Установить» показывают выбранный цвет мода, а не первый. Без неё — первая, как раньше. */
  const colour = /^[a-z]$/.test(String(input?.colour || "")) ? String(input.colour) : "";
  const resolved = {
    ...clothingArchiveTools(deps.stateDir),
    ...(deps.tools || {}),
  };
  /* Перекраска штатной вещи (круг 7): в пакете одни расцветки, модель — игровая; окно называет вещь (`input.game`), модель читается из игры игрока (`catalog-retexture-model.js`). */
  const textureOnly = !pickPackageModel((manifest?.files || []).filter((file) => file?.source && file.action !== "delete").map((file) => file.source));
  /* Подгружается, когда нужна: стартовый граф главного процесса её не несёт. */
  const retextureModule = textureOnly ? await import("./catalog-retexture-model.js") : null;
  const retexture = retextureModule ? retextureModule.retextureTarget(input) : null;
  if (textureOnly && !retexture)
    throw refusal(
      "CLOTHING_CATALOG_MODEL",
      "Это перекраска штатной вещи: в пакете одни текстуры, а модель — из вашей GTA V. Игру не нашли или вещь не названа — укажите папку GTA V и откройте снова.",
    );
  const cached = path.join(
    deps.stateDir,
    "clothing-models",
    "catalog",
    createHash("sha256")
      .update(`${id}@${version}|${slot}|${CATALOG_BUILD}${colour ? `|c:${colour}` : ""}${retexture ? `|g:${gameHash(retexture.gameRoot)}|${retexture.folder}|${retexture.drawable}` : ""}`)
      .digest("hex")
      .slice(0, 24) + ".glb",
  );
  let bytes = await fs.readFile(cached).catch(() => null);
  /* Крой вещи каталога — как у вещи игры, по её модели (фикс 5). */
  const shapeFile = `${cached}.shape.json`;
  let shape = bytes ? await fs.readFile(shapeFile, "utf8").then(JSON.parse).catch(() => null) : null;
  if (!bytes) {
    const { model, textures, colours } = await catalogClothingFiles(
      input,
      context,
      deps,
      { textureOnly: Boolean(retexture) },
    );
    if (!model) {
      /* Перекраска штатной вещи: модель — из игры игрока, расцветка — мода (`catalog-retexture-model.js`). */
      const picture = (colour && colours?.get(colour) && (await catalogPicture([colours.get(colour)]))) || (await catalogPicture(textures));
      const built = await (resolved.retextureModel || retextureModule.retextureGameModel)({ target: retexture, picture, slot, tools: resolved, stateDir: deps.stateDir, context });
      bytes = built.bytes;
      shape = built.shape;
    }
    if (model) try {
      /* Разбор модели — один на вещь и показ: другой цвет той же вещи меняет только текстуру (десятки миллисекунд вместо секунды). */
      const parsedKey = `${id}@${version}|${slot}`;
      let parsed = parsedCatalogModels.get(parsedKey);
      if (!parsed) {
        const raw = clothingDrawable(await fs.readFile(model), {
          inflateRaw: inflateRawNode,
        });
        parsed = {
          shape: garmentShape(raw, componentOfModelFile(model)),
          drawable: showcaseDrawable(raw, componentOfModelFile(model), { slot }),
        };
        parsedCatalogModels.set(parsedKey, parsed);
        if (parsedCatalogModels.size > PARSED_LIMIT) parsedCatalogModels.delete(parsedCatalogModels.keys().next().value);
      }
      shape = parsed.shape;
      const { drawable } = parsed;
      /* Выбранная расцветка; нет такой буквы в пакете — первая, как у вещи без выбора. */
      const picture = (colour && colours?.get(colour) && (await catalogPicture([colours.get(colour)]))) || (await catalogPicture(textures));
      if (drawable?.meshes.length)
        bytes = Buffer.from(
          await clothingModelGlb(drawable, picture, {
            category: slot === "tattoos" ? "tattoos" : null,
          }),
        );
    } catch {
      /* не прочлось на JS — нативный движок ниже */
    }
    if (!bytes) {
      const work = path.join(
        deps.stateDir,
        "clothing-models",
        "work",
        randomUUID(),
      );
      try {
        await fs.mkdir(work, { recursive: true });
        const output = path.join(work, "item.glb");
        await resolved.native(
          "convert-model",
          { input: model, output, textures },
          context,
        );
        bytes = await fs.readFile(output);
      } finally {
        await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      }
    }
    await atomicWrite(cached, bytes);
    if (shape?.sleeve) await atomicWrite(shapeFile, Buffer.from(JSON.stringify({ sleeve: shape.sleeve, hood: Boolean(shape.hood) }))).catch(() => {});
  }
  if (bytes.length > MAX_MODEL_BYTES)
    throw refusal(
      "CLOTHING_MODEL_LARGE",
      "Модель слишком велика для редактора.",
    );
  return {
    id,
    size: bytes.length,
    bytes: asArrayBuffer(bytes),
    ...(shape?.sleeve ? { shape: { sleeve: shape.sleeve, hood: Boolean(shape.hood) } } : {}),
  };
}
