/*
 * Текстуры для 3D-кадров мастерской: листы из файлов наборов и из игры
 * игрока.
 *
 * Кадр «Завода», «Ангара» и «Маппинга» показывает настоящие модели, и без
 * настоящих текстур они читаются плохо: реквизит в ровном среднем цвете —
 * это кубики, а не погрузчик и контейнер. Текстуры берутся двумя путями:
 *
 *   set  — из файла набора рядом с приложением (`resources/recolor/<набор>`):
 *          реквизит ангара несёт свои текстуры в самих моделях мода;
 *   game — из копии игры самого игрока (`x64t.rpf:levels/…/cs4_13_build3.ytd`):
 *          штатные листы завода для «Стандарта», соседи мест маппинга.
 *
 * Данные Rockstar никуда не уезжают: лист извлекается на машине игрока из его
 * собственной игры, уменьшается до размера кадра и лежит в его кэше. В
 * поставке Astral их нет, и окно получает их только отсюда.
 *
 * Ответ — WebP по порядку запроса (`null` — листа нет). Кэш на диске — по
 * источнику, имени, размеру и отпечатку файла-источника: новая версия игры
 * или набора — новые картинки.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { decodeTextureRef, normalMapRgba, readDrawable, readTextureDictionary, specularRoughnessRgba } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { createGameReader } from "./optimization-layers.js";
import { inflateResource } from "@modovik/native-rs";
import { lazyModule } from "./lazy-import.js";
import { dictionaryNames } from "./workshop-dictionary-names.js";
import { offThreadInflateEnabled, openResourceOffThread } from "./workshop-inflate.js";

/*
 * Редкие пути грузят свои модули при первом использовании, а не при запуске потока (18.11.2026): обычный запрос листов игры их не зовёт, а они стоят запуска потока (замер, Electron как Node, см. отчёт 19).
 *  • набор (`set`) и `overMods` — `recolor-customizer.js`, `@modovik/install-engine`;
 *  • блоки BCn и путь движка листов — `workshop-sheet-blocks.js`, `workshop-sheet-cache.js`, `workshop-sheets-engine.js`.
 * Одновременные первые вызовы ждут один `import()`, ошибка загрузки не запоминается (`lazy-import.js`).
 */
const recolorModule = lazyModule(() => import("./recolor-customizer.js"));
const installEngineModule = lazyModule(() => import("@modovik/install-engine"));
const sheetBlocksModule = lazyModule(() => import("./workshop-sheet-blocks.js"));
const sheetCacheModule = lazyModule(() => import("./workshop-sheet-cache.js"));
const sheetsEngineModule = lazyModule(() => import("./workshop-sheets-engine.js"));

const MAX_REQUESTS = 96;
/*
 * Стороны, до которых окно просит лист (`model-stage/sheet-budget.js`: ступени 128…1024, у больших поверхностей ближе 40 м — 2048).
 * 2048 в списке не было, и любая просьба «2048» молча превращалась в 512: ближняя большая земля, дороги и фасады стояли в 512, хотя окно
 * ждало 2048 (его ключ листа несёт `@2048`, а ключ на диске считался от 512 — 14.11.2026). Размер вне списка по-прежнему становится 512.
 * Лист не растягивается: размер — предел стороны (`decodeTextureRef` берёт первый уровень, что в него влезает), меньший лист остаётся своим.
 */
const SIZES = Object.freeze([64, 128, 256, 512, 1024, 2048]);
export const SHEET_SIDES = SIZES;
const SETS = new Set(["zones", "factory", "hangar", "mapping", "arenas"]);
/* У арены файлы лежат по папкам серверов: `gta5rp/…`, `majestic/…`. */
const ARENA_FILE_NAME = /^(?:gta5rp|majestic)\/[a-z0-9_+.-]{1,120}\.(?:ydr|yft|ytd|ydd)$/;
const FILE_NAME = /^[a-z0-9_+.-]{1,120}\.(?:ydr|yft|ytd|ydd)$/;
/* Имена листов у Rockstar бывают склеены из двух (`…_lines_a`), с пробелом нет. */
const TEXTURE_NAME = /^[a-z0-9_.+-]{1,160}$/;
const LOCATION =
  /^(x64[a-z]\.rpf|update|update\/x64\/dlcpacks\/[a-z0-9_]{1,40}\/dlc\.rpf):((?:[a-z0-9_+.-]{1,80}\/){0,12}[a-z0-9_+.-]{1,120}\.(?:ydr|yft|ytd|ydd))$/;
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;

const inflateRaw = inflateResource;

/*
 * Лист мода, что целиком чёрный и непрозрачный (ТЗ 43Б, 20.10.2026: плакаты арены GTA 5 RP «с каким-то модом» были
 * чёрными): такой лист — пустышка или нечитаемая копия, а не картинка; кадр берёт вместо него лист игры. Прозрачный
 * лист (наклейки, что Astral убирает) чёрным не считается — его прозрачность и есть «убрано».
 */
export function sheetIsBlack(rgba) {
  let seen = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] < 128) return false;
    if (rgba[at] > 12 || rgba[at + 1] > 12 || rgba[at + 2] > 12) return false;
    seen += 1;
  }
  return seen > 0;
}

const defaultTools = () => ({
  decode: decodeTextureRef,
  archiveSupport: provisionArchiveSupport,
  openGame: async (gameRoot, keys) => createGameReader(gameRoot, await keysFromDirectory(keys || "")),
  setRoot: async (set) => (await recolorModule()).recolorResourceRoot(set),
});

const sha = (text) => createHash("sha256").update(text).digest("hex");

/* Файлы поставленных модов каталога в игре `gameRoot` (`modFilesUnder`). */
async function overModsOf(stateDir, gameRoot) {
  const [{ inspectProfile }, { modFilesUnder }] = await Promise.all([installEngineModule(), recolorModule()]);
  const state = await inspectProfile({ stateDir });
  const target = Object.entries(state?.targets || {}).find(
    ([, item]) => item?.gameRoot && path.resolve(item.gameRoot).toLowerCase() === gameRoot.toLowerCase(),
  );
  return target ? modFilesUnder(async () => state, stateDir, target[0]) : new Map();
}

function requireGameRoot(value) {
  const selected = String(value || "").trim();
  if (!selected || !path.isAbsolute(selected)) return "";
  return path.resolve(selected);
}

/* Запрос одного листа — проверенный, приведённый к нижнему регистру. */
function normalizeRequest(item) {
  if (!item || typeof item !== "object") return null;
  const name = String(item.name || "").toLowerCase();
  if (!TEXTURE_NAME.test(name)) return null;
  const size = SIZES.includes(Number(item.size)) ? Number(item.size) : 512;
  /* Карта нормалей или блеска (`normal` / `specular`): лист переводится в свой вид и кэшируется отдельно от диффуза. */
  const map = item.normal === true ? "normal" : item.specular === true ? "specular" : null;
  if (item.set) {
    const set = String(item.set);
    const file = String(item.file || "").toLowerCase();
    if (!SETS.has(set) || !(set === "arenas" ? ARENA_FILE_NAME : FILE_NAME).test(file)) return null;
    return { kind: "set", set, file, name, size, map, blocks: item.blocks === true };
  }
  const game = String(item.game || "").replace(/\\/g, "/").toLowerCase();
  const match = LOCATION.exec(game);
  if (!match || match[2].split("/").some((part) => part === ".." || part === ".")) return null;
  return { kind: "game", location: game, archive: match[1], name, size, map, blocks: item.blocks === true };
}

/* Листы открытого ресурса: словарь целиком или встроенные в модель. */
function texturesOfResource(resource, fileName) {
  if (fileName.endsWith(".ytd")) return readTextureDictionary(resource);
  return readDrawable(resource, { inflateRaw }).drawables.flatMap((drawable) => drawable.embeddedTextures || []);
}

/* Листы ресурса: словарь целиком или встроенные в модель. */
export function resourceTextures(bytes, fileName) {
  return texturesOfResource(openResourceWith(bytes, inflateRaw), fileName);
}

async function encode(rgba, width, height, { normal = false } = {}) {
  let opaque = true;
  for (let at = 3; at < rgba.length; at += 4)
    if (rgba[at] < 250) {
      opaque = false;
      break;
    }
  const image = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 },
  });
  /* Карта нормалей — без потерь: сжатие с потерями мнёт наклоны и даёт рябь на плоских стенах. */
  if (normal) return image.removeAlpha().webp({ lossless: true, effort: 4 }).toBuffer();
  return (opaque ? image.removeAlpha() : image).webp({ quality: 84, alphaQuality: 90, effort: 3 }).toBuffer();
}

const asArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/*
 * Сжатые листы (этап 2, шаг A2). Окно просит блоки BCn вместо WebP только за выключателем (по умолчанию он выключен): верхний уровень запроса несёт
 * `accept` — какие форматы умеет видеокарта, а запись листа, которой нужны блоки, — `blocks: true`. Запись без `blocks` отвечается WebP, как всегда,
 * даже если `accept` есть: в одной пачке едут листы сцены и листы для холста. Ответ у записи с `blocks` — контейнер ASB1 с одной записью
 * (`workshop-sheet-blocks.js`; те же байты, что файл кэша `bcn1/*.asb`): блоки BCn, а негодный лист (карта нормалей и блеска, неподходящий формат или
 * размер, ошибка сборки) — тот же WebP, что у записи без `blocks`, внутри контейнера. Форма ответа прежняя: `{ textures: [ArrayBuffer | null], status }`.
 */
const SHEET_FORMATS = Object.freeze(["BC7", "DXT1", "DXT3", "DXT5"]);

/** Форматы запроса: из списка, без повторов, по алфавиту (он же — часть ключа кэша). Пусто — блоки не нужны. */
function acceptOf(input) {
  const list = Array.isArray(input?.accept) ? input.accept : [];
  return [...new Set(list.filter((name) => SHEET_FORMATS.includes(name)))].sort();
}

/* Один кэш блоков на папку на весь сеанс читателя (обход папки — один раз), а не на каждый вызов. */
const sheetCaches = new Map();
async function sheetCacheFor(cacheDir) {
  if (!sheetCaches.has(cacheDir)) {
    const { createSheetCache } = await sheetCacheModule();
    /* Пока модуль грузился, соседний вызов мог завести кэш этой папки: он один на папку. */
    if (!sheetCaches.has(cacheDir)) sheetCaches.set(cacheDir, createSheetCache({ root: cacheDir }));
  }
  return sheetCaches.get(cacheDir);
}

/** Для тестов: кэши блоков живут весь сеанс читателя. Возвращает обещание, что дописаны начатые записи. */
export async function forgetSheetCaches() {
  const caches = [...sheetCaches.values()];
  sheetCaches.clear();
  await Promise.all(caches.map((cache) => cache.idle()));
}

/** ArrayBuffer ровно под байты: если буфер свой и целый — он сам (без копии), иначе срез. */
const ownArrayBuffer = (bytes) => (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : asArrayBuffer(bytes));

/** Бит «из кэша» (бит 2 флагов у первой записи контейнера) — в самом буфере, без копии файла. */
const CACHED_FLAG_AT = 16 + 13;

/*
 * Лист, которого нет в своём файле, игра берёт у родителей словаря: у
 * района — словари той же папки (`sp1_10.ytd`, `sp1_10_stadium.ytd`), у
 * города — общие словари `gtxd` (дороги, парковки, бордюры, трава). Кадр
 * ищет так же, иначе общие листы рисовались ровным серым (фасад арены
 * GTA5RP — целиком, ТЗ 04.10.2026). Оглавление листов папки — раз за
 * сеанс приложения (имя листа → файл).
 */
const GLOBAL_DICTIONARIES = "x64g.rpf:levels/gta5/generic/gtxd.rpf";
const parentIndexes = new Map();
/* Оглавления, которым нельзя верить как полным (см. `folderIndex`): на диск не пишутся, из `parentIndexes` уходят сразу после обхода, живут в `doubts`. */
const doubtfulIndexes = new WeakSet();
/*
 * Сомнительные оглавления на уровне модуля (как `parentIndexes`, предел тот же): ключ → { names, at (когда обошли), retries (сколько повторных обходов уже было) }.
 * Новый обход разрешён, когда с прошлого прошло не меньше `DOUBT_RETRY_MS`, и не больше `DOUBT_RETRIES` раз на папку за жизнь потока; после последнего неудачного повтора
 * оглавление остаётся до конца жизни потока (как раньше по скорости), а ненайденные листы отвечаются «недоступен». Постоянно нечитаемый словарь не должен стоить обхода на каждый вход в редактор.
 */
export const DOUBT_RETRY_MS = 30_000;
export const DOUBT_RETRIES = 3;
const doubts = new Map();
const indexKey = (gameRoot, folder) => `${gameRoot.toLowerCase()}|${folder}`;

/*
 * Оглавление папки и общего словаря — на диске, по отпечатку архива (13.10.2026,
 * замер на Windows: лист без своего файла тянул скан словарей папки и города —
 * пять секунд в каждом сеансе). Скан читает все словари папки целиком, поэтому
 * сохраняется только полный: оборвавшееся чтение не запоминается, иначе лист
 * стал бы «нет в игре» навсегда. Пустой итог — тоже не всегда полный: у архива, что не
 * открылся, читатель игры отдаёт пустой список папки (`game-archive-reader.js`: `Shelf.#attempt`
 * глотает отказ открытия, `list` → `[]`), и обход «успешно» находил ноль словарей. Поэтому пустое
 * оглавление считается полным, только если читатель сам подтверждает, что папка есть в открытом
 * архиве (`has`; у подставного читателя без `has` — как было). Версия оглавления прежняя
 * (`INDEX_VERSION` не поднимали: новая версия сбросила бы у всех пятисекундный обход); пустое
 * оглавление, уже лежащее на диске, принимается по той же проверке — иначе идёт обход, и файл
 * перезаписывается.
 */
const INDEX_VERSION = 1;

/* Файл словаря листов папки: HD-копии (`+hi`, `+hidr`) — те же листы крупнее, кадру не нужны. */
const isDictionaryFile = (file) => file.endsWith(".ytd") && !/\+hi(dr)?\.ytd$/.test(file);

/* Папка есть в открытом архиве? Читатель без `has` (подставной в проверках) отвечает «да»: его пустой список — честный. */
async function folderExists(game, folder) {
  if (typeof game.has !== "function") return true;
  try {
    return Boolean(await game.has(folder));
  } catch {
    return false;
  }
}

/** Пустое оглавление с диска — честное: папка есть в открытом архиве и словарей в ней нет. Не проверить (игра не открылась, читатель отказал) — не принимается. */
async function storedEmptyHolds(getGame, folder) {
  try {
    const game = await getGame();
    if (typeof game.has !== "function") return true;
    if (!(await folderExists(game, folder))) return false;
    const files = typeof game.list === "function" ? await game.list(folder) : [];
    return !files.some(isDictionaryFile);
  } catch {
    return false;
  }
}

async function readIndexFile(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (parsed?.v !== INDEX_VERSION || !Array.isArray(parsed.names)) return null;
    return new Map(parsed.names);
  } catch {
    return null;
  }
}

async function writeIndexFile(file, names) {
  await fs.writeFile(file, JSON.stringify({ v: INDEX_VERSION, names: [...names] })).catch(() => {});
}

/** Отпечаток архива (его размер и время) — как у листов, по адресу в папке игры. */
async function archiveStampOf(gameRoot, archive) {
  const file = path.join(gameRoot, archive === "update" ? "update/update.rpf" : archive);
  const stat = await fs.stat(file).catch(() => null);
  return stat?.isFile() ? `${stat.size}:${Math.round(stat.mtimeMs)}` : null;
}

/*
 * Оглавление листов папки: имя → файл. `getGame` открывает игру только тогда,
 * когда оглавления нет на диске — тёплый сеанс архивов не трогает совсем.
 * Ошибка чтения списка или словаря отдаётся вызывающему (лист «недоступен»), а
 * не превращается в пустое оглавление. Так же с обходом, что дошёл до конца с
 * неполным итогом (словарь не прочитался; ни одного словаря, а читатель не
 * подтверждает, что папка есть в открытом архиве — архив не открылся): оглавление
 * сомнительное — оно не пишется на диск и не остаётся в `parentIndexes` (его получают
 * только те, кто присоединился к обходу), а лист, которого по нему не нашли,
 * отвечается «недоступен» (`parentLocation`), не «нет в игре». Обход повторяется не чаще раза
 * в `DOUBT_RETRY_MS` и не больше `DOUBT_RETRIES` раз на папку (`doubts`): чтение всех словарей на
 * каждый вход в редактор — это пять секунд на ПК с медленным диском. Полный обход стирает запись.
 *
 * Оглавление папки одно на процесс: пачки, которым нужна одна и та же папка, ждут один обход (`probe.scan.joined` считает присоединившихся). Обход читает словари
 * папки по `SCAN_READS` одновременно, чтобы чтение следующего шло, пока разбирается предыдущий, а имена берёт из системной области без распаковки картинок
 * (`workshop-dictionary-names.js`); имена складываются по порядку отсортированных файлов, как при чтении по одному (при совпадении имён побеждает первый файл).
 */
const SCAN_READS = 4;

function folderIndex(getGame, gameRoot, folder, cache, probe = NO_PROBE) {
  const key = indexKey(gameRoot, folder);
  if (parentIndexes.has(key)) probe.count("scanJoined");
  else {
    /* Сомнительное оглавление: пока не пришёл срок повтора (или повторы кончились) — прежнее, без обхода. */
    const previous = doubts.get(key);
    if (previous && (previous.retries >= DOUBT_RETRIES || cache.now() - previous.at < DOUBT_RETRY_MS)) return previous.names;
    if (parentIndexes.size > 64) parentIndexes.delete(parentIndexes.keys().next().value);
    const pending = (async () => {
      const archive = folder.slice(0, folder.indexOf(":"));
      const stamp = await cache.stampOf(archive);
      const file = stamp && cache.dir ? path.join(cache.dir, `index-${sha(`${key}|${stamp}`).slice(0, 32)}.json`) : null;
      if (file) {
        const stored = await readIndexFile(file);
        /* Пустое оглавление с диска мог записать прежний код при не открывшемся архиве: принимается, только если читатель подтверждает пустую папку (`storedEmptyHolds`). */
        if (stored && (stored.size > 0 || (await storedEmptyHolds(getGame, folder)))) {
          probe.count("scanDisk");
          doubts.delete(key);
          return stored;
        }
      }
      const began = probe.now();
      const game = await getGame();
      const names = new Map();
      let complete = true;
      const files = typeof game.list === "function" ? await game.list(folder) : [];
      /* HD-копии (`+hi`, `+hidr`) — те же листы крупнее, кадру не нужны. */
      const dictionaries = files.filter(isDictionaryFile).sort();
      /* Ни одного словаря: если читатель не подтверждает, что папка есть в открытом архиве, это отказ открытия (`list` → `[]`), а не пустая папка. */
      if (dictionaries.length === 0 && !(await folderExists(game, folder))) complete = false;
      const found = new Array(dictionaries.length).fill(null);
      let cursor = 0;
      const lane = async () => {
        while (cursor < dictionaries.length) {
          const at = cursor;
          cursor += 1;
          const bytes = await game.read(dictionaries[at]).catch(() => null);
          if (!bytes) {
            complete = false;
            continue;
          }
          if (bytes.length > MAX_RESOURCE_BYTES) continue;
          probe.count("scanFiles");
          probe.count("scanBytes", bytes.length);
          try {
            const read = dictionaryNames(bytes);
            probe.count(read.quick ? "scanQuick" : "scanFull");
            found[at] = read.names;
          } catch {
            /* чужой или битый словарь — дальше без него */
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(SCAN_READS, dictionaries.length) }, lane));
      for (const [at, list] of found.entries()) for (const name of list ?? []) if (!names.has(name)) names.set(name, dictionaries[at]);
      /* Полное — на диск, запись о сомнении стирается. Неполное (словарь не прочитался, архив не открылся) — сомнительное: на диск не идёт, из `parentIndexes` уходит сразу, живёт в `doubts`. */
      if (complete) {
        doubts.delete(key);
        if (file) await writeIndexFile(file, names);
      } else {
        doubtfulIndexes.add(names);
        doubts.delete(key);
        if (doubts.size >= 64) doubts.delete(doubts.keys().next().value);
        doubts.set(key, { names, at: cache.now(), retries: previous ? previous.retries + 1 : 0 });
      }
      probe.add("scan", began);
      probe.count("scans");
      return names;
    })();
    parentIndexes.set(key, pending);
    /* Неудача и сомнительный итог не остаются в памяти: следующий лист (пачка) спросит заново; кто присоединился к этому обходу, итог уже получил. */
    pending.then(
      (names) => {
        if (doubtfulIndexes.has(names) && parentIndexes.get(key) === pending) parentIndexes.delete(key);
      },
      () => {
        if (parentIndexes.get(key) === pending) parentIndexes.delete(key);
      },
    );
  }
  return parentIndexes.get(key);
}

/**
 * Файл-родитель листа `request.name`: словарь папки или общий словарь города. Не нашли, а оглавление, по которому искали, сомнительное
 * (неполное или пустое, `folderIndex`) — бросает: «нет в игре» тут не доказано, `locate` отвечает «недоступен», лист ещё может приехать.
 */
async function parentLocation(getGame, gameRoot, request, cache, probe = NO_PROBE) {
  const folder = request.location.slice(0, request.location.lastIndexOf("/"));
  let doubtful = null;
  for (const place of [folder, GLOBAL_DICTIONARIES]) {
    const index = await folderIndex(getGame, gameRoot, place, cache, probe);
    const found = index.get(request.name);
    if (found && found !== request.location) return found;
    if (doubtfulIndexes.has(index)) doubtful ??= place;
  }
  if (doubtful) throw Object.assign(new Error(`Оглавление ${doubtful} неполное или пустое: листа в нём нет, но «нет в игре» не доказано.`), { code: "PARENT_INDEX_DOUBTFUL" });
  return null;
}

/** Для тестов: оглавления папок живут в памяти процесса. */
export function forgetParentIndexes() {
  parentIndexes.clear();
  doubts.clear();
}

/*
 * Чем кончилась просьба о листе — это решает служба, а не окно:
 *   ok          — лист пришёл;
 *   absent      — лист окончательно не найден (в файле и у родителей, либо
 *                 просьба составлена так, что листа быть не может);
 *   unavailable — игры или файла нет, архив не открылся: лист ещё может
 *                 приехать, и кадр, снятый без него, неполный.
 */
export const SHEET_STATUS = Object.freeze({ ok: "ok", absent: "absent", unavailable: "unavailable" });

/*
 * Общий сеанс чтения игры (запрос с `share: true`; окно шлёт его во всех пачках листов, когда включён `astral.sheets.bcn.v1`). Раньше каждая пачка открывала
 * игру заново и закрывала её, а разобранные словари жили одну пачку: словарь, попавший в две пачки, читался и распаковывался дважды, а читатель держит до
 * `READ_SLOTS` пачек разом. Теперь пачки одного захода делят один открытый читатель игры и одну таблицу разобранных ресурсов — на пару «папка игры, папка ключей».
 *
 *   — Счётчик пользователей: пачка берёт сеанс при старте и отдаёт в конце. Пачек не осталось — игра закрывается, а таблица очищается через `SESSION_IDLE_MS`:
 *     следующая пачка того же захода успевает подхватить, а простаивающий сеанс не держит архивы открытыми (установка модов заменяет `update.rpf`, открытый дескриптор
 *     ей мешает). Таймер не держит процесс (`unref`).
 *   — Ключ ресурса несёт отпечаток архива («размер:время»): изменившийся архив никогда не отдаёт старый разбор; старые разборы того же ресурса из таблицы уходят.
 *   — Неудачное чтение в таблице не остаётся; «файла нет» тоже не запоминается (архив мог не открыться).
 *   — Потолок памяти таблицы — `RESOURCE_BUDGET_BYTES` по разжатым байтам ресурсов; сверх него уходят давно не использованные. Ресурс, что держит хоть одна идущая пачка,
 *     не вытесняется (потолок мягкий: в нём может оказаться больше, пока такие пачки идут; с их концом лишнее уходит).
 *
 * Задержка 2 с: окно шлёт пачки в течение одного захода со сдвигом в десятки и сотни миллисекунд (пачки по 20 листов, очередь на восемь мест), а промежутки между
 * заходами — секунды и больше; 2 с перекрывают первое и не заставляют ждать второго. Потолок 256 МБ: самый большой ресурс, что читается вообще, — 64 МБ
 * (`MAX_RESOURCE_BYTES`), так что в таблицу помещаются четыре таких или сотни обычных (в наборах мастерской медиана разжатого словаря — 26 КБ, девятый дециль — 8,6 МБ);
 * прежде восемь одновременных пачек держали по своей таблице, и один словарь мог лежать в памяти восемь раз.
 */
export const SESSION_IDLE_MS = 2000;
export const RESOURCE_BUDGET_BYTES = 256 * 1024 * 1024;
/* Предохранитель от россыпи мелких записей (пустые словари, чужие файлы): больше записей — уходят давние. */
const MAX_TABLE_ENTRIES = 2048;
const sessions = new Map();

function acquireSession(key) {
  let session = sessions.get(key);
  if (!session) {
    session = { key, users: 0, game: null, resources: new Map(), bytes: 0, tick: 0, timer: null };
    sessions.set(key, session);
  }
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  session.users += 1;
  return session;
}

async function closeSession(session) {
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  if (sessions.get(session.key) === session) sessions.delete(session.key);
  const opening = session.game;
  session.game = null;
  session.resources.clear();
  session.bytes = 0;
  if (!opening) return;
  try {
    await (await opening)?.close?.();
  } catch {
    /* не открылась или не закрывается — держать нечего */
  }
}

function releaseSession(session, idleMs) {
  session.users -= 1;
  if (session.users > 0) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    session.timer = null;
    if (session.users === 0) void closeSession(session);
  }, Math.max(0, idleMs));
  session.timer.unref?.();
}

/** Для тестов и выхода: закрыть все сеансы сейчас и дождаться закрытия игры. */
export async function closeSheetSessions() {
  await Promise.all([...sessions.values()].map((session) => closeSession(session)));
}

/** Сколько байт держат ссылки на листы: разжатые данные ресурса (общие у листов одного словаря считаются раз). */
function sizeOfRefs(refs) {
  const seen = new Set();
  let size = 0;
  for (const ref of refs) {
    const data = ref?.resource?.data;
    if (data && !seen.has(data)) {
      seen.add(data);
      size += data.byteLength;
    }
  }
  return size;
}

function dropEntry(session, entry) {
  if (session.resources.get(entry.key) === entry) session.resources.delete(entry.key);
  if (entry.counted) {
    entry.counted = false;
    session.bytes -= entry.size;
  }
}

/** Старые разборы того же ресурса (другой отпечаток архива) не нужны: уходят, если их никто не читает. */
function dropStale(session, entry) {
  for (const other of session.resources.values()) if (other !== entry && other.base === entry.base && other.ready && other.pins === 0) dropEntry(session, other);
}

/** Потолок по байтам (и по числу записей): уходят давно не использованные, прочитанные до конца и никем не читаемые сейчас. */
function enforceBudget(session, budget) {
  while (session.bytes > budget || session.resources.size > MAX_TABLE_ENTRIES) {
    let victim = null;
    for (const entry of session.resources.values()) if (entry.ready && entry.pins === 0 && (!victim || entry.used < victim.used)) victim = entry;
    if (!victim) return;
    dropEntry(session, victim);
  }
}

/*
 * Счётчики времени читателя (`timings: true` в запросе — поле `timings` ответа; `ASTRAL_SHEETS_TIMINGS=1` — строка JSON на пачку в `timings.jsonl` в папке кэша листов).
 * Без них — пустой счётчик без работы. Время — целые миллисекунды, остальное — штуки и байты; описание полей — `docs/perf/speed-3d-rust/a2-bcn-switch.md`.
 */
const NO_PROBE = Object.freeze({ on: false, now: () => 0, add() {}, count() {}, set() {}, sheet() {}, report: () => null });

function createProbe(enabled) {
  if (!enabled) return NO_PROBE;
  const ms = Object.create(null);
  const n = Object.create(null);
  const int = (value) => Math.round(value || 0);
  const probe = {
    on: true,
    /* Итог пути движка за пачку (`workshop-sheets-engine.js`): ставит читатель; без движка поля нет. */
    engine: null,
    ms,
    now: () => performance.now(),
    add(name, since) {
      ms[name] = (ms[name] || 0) + (performance.now() - since);
    },
    count(name, by = 1) {
      n[name] = (n[name] || 0) + by;
    },
    set(name, value) {
      ms[name] = value;
    },
    /** Итог по листу: `how` — `{ kind: "blocks" | "webp", cached }` у отданного, ничего у отказа. */
    sheet(state, how) {
      n.total = (n.total || 0) + 1;
      if (state !== SHEET_STATUS.ok || !how) {
        n.refused = (n.refused || 0) + 1;
        return;
      }
      n[how.kind === "blocks" ? "blocks" : "webp"] = (n[how.kind === "blocks" ? "blocks" : "webp"] || 0) + 1;
      if (how.cached) n.cached = (n.cached || 0) + 1;
    },
    report({ share }) {
      const report = {
        share,
        queueMs: int(ms.queue),
        totalMs: int(ms.total),
        openMs: int(ms.open),
        opens: n.opens || 0,
        resources: { loaded: n.loaded || 0, reused: n.reused || 0, merged: n.merged || 0, offloaded: n.offloaded || 0, bytes: n.bytes || 0, ms: int(ms.read) },
        parentMs: int(ms.parent),
        scan: { runs: n.scans || 0, joined: n.scanJoined || 0, disk: n.scanDisk || 0, files: n.scanFiles || 0, quick: n.scanQuick || 0, full: n.scanFull || 0, bytes: n.scanBytes || 0, ms: int(ms.scan) },
        blocksMs: int(ms.blocks),
        webp: { rendered: n.webps || 0, ms: int(ms.webp) },
        cache: { readMs: int(ms.cacheRead), hitsBlocks: n.hitsBlocks || 0, hitsWebp: n.hitsWebp || 0, writeMs: int(ms.cacheWrite), putsBlocks: n.putsBlocks || 0 },
        sheets: { total: n.total || 0, blocks: n.blocks || 0, webp: n.webp || 0, cached: n.cached || 0, refused: n.refused || 0 },
      };
      if (probe.engine) report.engine = probe.engine;
      return report;
    },
  };
  return probe;
}

/* Строки `timings.jsonl`: пишутся без ожидания ответа и без падений при ошибке диска; к строке добавляется время записи блоков (оно известно после ответа). */
const timingWrites = new Set();
function writeTimingsLine(dir, report, puts, probe) {
  const job = (async () => {
    await Promise.all(puts);
    const line = { at: Date.now(), pid: process.pid, ...report, cache: { ...report.cache, putsMs: Math.round(probe.ms.putAsync || 0) } };
    await fs.appendFile(path.join(dir, "timings.jsonl"), `${JSON.stringify(line)}\n`);
  })()
    .catch(() => {})
    .finally(() => timingWrites.delete(job));
  timingWrites.add(job);
}

/** Для тестов: дождаться записи начатых строк `timings.jsonl`. */
export async function settleTimings() {
  await Promise.all([...timingWrites]);
}

/**
 * Листы для кадра: `input = { gameRoot?, keys?, textures: [{ name, size?,
 * set, file } | { name, size?, game: "x64t.rpf:…/файл.ytd" }] }`. Ответ —
 * `{ textures: [ArrayBuffer | null], status: ["ok" | "absent" | "unavailable"] }`
 * в порядке запроса; `status` — почему `null`.
 */
async function readTextures(input, stateDir, tools = {}, meta = {}) {
  const t = { ...defaultTools(), ...tools };
  const list = Array.isArray(input?.textures) ? input.textures.slice(0, MAX_REQUESTS) : [];
  const requests = list.map(normalizeRequest);
  const gameRoot = requireGameRoot(input?.gameRoot);
  const cacheDir = path.join(stateDir || os.tmpdir(), "workshop-textures");
  await fs.mkdir(cacheDir, { recursive: true });

  /* Счётчики времени по этапам: только по просьбе (`timings: true`) или при `ASTRAL_SHEETS_TIMINGS=1`; иначе ничего не считается и не пишется. */
  const wantResponse = input?.timings === true;
  const probe = createProbe(wantResponse || process.env.ASTRAL_SHEETS_TIMINGS === "1");
  const batchBegan = probe.now();

  /* Отпечаток источника: у набора — размер и время файла, у игры — архива. */
  const stamps = new Map();
  async function stampOf(request) {
    const key = request.kind === "set" ? `set:${request.set}/${request.file}` : `game:${request.archive}`;
    if (!stamps.has(key)) {
      stamps.set(
        key,
        (async () => {
          const file =
            request.kind === "set"
              ? path.join(await t.setRoot(request.set), request.file)
              : path.join(gameRoot, request.archive === "update" ? "update/update.rpf" : request.archive);
          const stat = await fs.stat(file).catch(() => null);
          return stat?.isFile() ? `${stat.size}:${Math.round(stat.mtimeMs)}` : null;
        })(),
      );
    }
    return stamps.get(key);
  }
  /* Отпечаток архива по метке места (`x64t.rpf`, `update`, `update/x64/dlcpacks/…/dlc.rpf`): лист у родителей может лежать в другом архиве, чем сама просьба. */
  const labelStamps = new Map();
  const stampOfLabel = (label) => {
    if (!labelStamps.has(label)) labelStamps.set(label, archiveStampOf(gameRoot, label));
    return labelStamps.get(label);
  };

  /* Оглавления папок — на диске, рядом с листами (см. `folderIndex`). */
  const indexCache = { dir: cacheDir, stampOf: (archive) => archiveStampOf(gameRoot, archive), now: typeof t.now === "function" ? t.now : () => performance.now() };

  /*
   * Игра и разобранные ресурсы. Обычно — на одну пачку: открыли, прочитали, закрыли; ресурсы читаются по разу на ответ (у модели десяток листов). С `share: true` пачки
   * одного захода делят один сеанс (`acquireSession`): один открытый читатель игры и одна таблица ресурсов; закрывается он, когда пачек не осталось, через `SESSION_IDLE_MS`.
   */
  /* Без `share` пачки тоже делят сеанс, но только пока идут одновременно: последняя ушедшая закрывает игру и очищает таблицу сразу, как раньше (отдельный сеанс `|plain`, задержки нет).
     Раньше каждая из восьми одновременных пачек открывала архивы заново и читала один и тот же словарь у себя — таблица ресурсов и открытая игра теперь общие. */
  const shared = input?.share === true;
  const sessionKey = `${gameRoot.toLowerCase()}|${String(input?.keys || "")}`;
  const session = acquireSession(shared ? sessionKey : `${sessionKey}|plain`);
  const idleMs = Number.isFinite(t.sessionIdleMs) ? t.sessionIdleMs : SESSION_IDLE_MS;
  const budget = Number.isFinite(t.resourceBudgetBytes) ? t.resourceBudgetBytes : RESOURCE_BUDGET_BYTES;
  const pinned = new Set();
  const openGame = async () => {
    const keys = await archiveKeysDirectory({ keys: input?.keys, stateDir, provision: t.archiveSupport });
    probe.count("opens");
    return t.openGame(gameRoot, keys);
  };
  async function gameReader() {
    const began = probe.now();
    try {
      if (!session.game) {
        const opening = openGame();
        session.game = opening;
        /* Неудача не остаётся: следующий вызов откроет заново. */
        opening.catch(() => {
          if (session.game === opening) session.game = null;
        });
      }
      return await session.game;
    } finally {
      probe.add("open", began);
    }
  }

  const offThread = t.offThreadInflate === undefined ? offThreadInflateEnabled() : t.offThreadInflate === true;

  /* Прочитать и разобрать один ресурс: словарь целиком или модель со встроенными листами. */
  async function readResource(request) {
    let bytes = null;
    let began = 0;
    if (request.kind === "set") {
      const root = await t.setRoot(request.set);
      began = probe.now();
      bytes = await fs.readFile(path.join(root, request.file)).catch(() => null);
    } else {
      if (!gameRoot) return { refs: [], retain: true };
      const reader = await gameReader();
      began = probe.now();
      bytes = await reader.read(request.location);
    }
    if (!bytes || bytes.length > MAX_RESOURCE_BYTES) {
      probe.add("read", began);
      /* Нет файла — не запоминается (архив мог не открыться); слишком большой — это ответ, он запоминается. */
      return { refs: [], retain: Boolean(bytes) };
    }
    const fileName = request.kind === "set" ? request.file : request.location.split("/").pop();
    let refs = [];
    try {
      /* Распаковка уходит в пул потоков (`workshop-inflate.js`): поток читателя тем временем читает архив и разбирает другие словари. */
      if (offThread) {
        const opened = await openResourceOffThread(bytes);
        if (opened.offloaded) probe.count("offloaded");
        refs = texturesOfResource(opened.resource, fileName);
      } else refs = resourceTextures(new Uint8Array(bytes), fileName);
    } catch {
      refs = [];
    }
    probe.add("read", began);
    probe.count("loaded");
    probe.count("bytes", bytes.length);
    return { refs, retain: true };
  }

  async function texturesOf(request) {
    /* Общая таблица: ключ несёт отпечаток архива — изменившийся архив не отдаёт старый разбор. */
    const stamp = request.kind === "set" ? await stampOf(request) : await stampOfLabel(request.location.slice(0, request.location.indexOf(":")));
    if (!stamp) return (await readResource(request)).refs;
    const base = request.kind === "set" ? `set:${request.set}/${request.file}` : `game:${request.location}`;
    const key = `${base}|${stamp}`;
    let entry = session.resources.get(key);
    if (entry) {
      probe.count("reused");
      /* Чтение ещё идёт (его начала другая пачка или этот же запрос раньше): пачка присоединилась к нему вместо второго чтения. */
      if (!entry.ready) probe.count("merged");
    } else {
      entry = { key, base, ready: false, size: 0, counted: false, used: 0, pins: 0, promise: null };
      session.resources.set(key, entry);
      dropStale(session, entry);
      const created = entry;
      created.promise = readResource(request).then(
        ({ refs, retain }) => {
          created.ready = true;
          created.size = sizeOfRefs(refs);
          if (session.resources.get(key) === created) {
            if (retain) {
              created.counted = true;
              session.bytes += created.size;
            } else session.resources.delete(key);
          }
          enforceBudget(session, budget);
          return refs;
        },
        (error) => {
          /* Неудача не остаётся в таблице: следующая пачка прочитает заново. */
          if (session.resources.get(key) === created) session.resources.delete(key);
          throw error;
        },
      );
    }
    entry.used = (session.tick += 1);
    if (!pinned.has(entry)) {
      pinned.add(entry);
      entry.pins += 1;
    }
    return entry.promise;
  }

  /* Нет в своём файле — у родителей, как у игры. Игра, что не открылась
     при поиске у родителей, — «недоступно», а не «листа нет». */
  const locate = async (wanted) => {
    let found = (await texturesOf(wanted)).find((item) => item.name.toLowerCase() === wanted.name);
    let failed = false;
    if (!found && wanted.kind === "game") {
      const began = probe.now();
      try {
        const parent = await parentLocation(gameReader, gameRoot, wanted, indexCache, probe);
        probe.add("parent", began);
        if (parent) found = (await texturesOf({ ...wanted, location: parent })).find((item) => item.name.toLowerCase() === wanted.name);
      } catch {
        probe.add("parent", began);
        failed = true;
      }
    }
    return { ref: found, unreadable: failed };
  };

  /* Лист в WebP, как всегда: разбор уровня, подмена чёрного листа мода листом игры, перевод карты нормалей или блеска, кодирование. */
  const renderSheetWebp = async (request, ref, { stock = true } = {}) => {
    const began = probe.now();
    try {
      let level = t.decode(ref, { maxSize: request.size });
      /* Лист мода — чёрный квадрат: берём лист игры (ТЗ 43Б). */
      if (stock && request.stock && sheetIsBlack(level.rgba)) {
        const { ref: stockRef } = await locate(request.stock);
        if (stockRef) level = t.decode(stockRef, { maxSize: request.size });
      }
      /* Карта нормалей игры (X в альфе или красном) → RGB, как ждёт кадр. */
      if (request.map) {
        /* Карта блеска — серое R: в шероховатость зелёного; нормаль — X/Y по формату. Оба без потерь. */
        const rgba = request.map === "normal" ? normalMapRgba(level.rgba, ref.format) : specularRoughnessRgba(level.rgba);
        return await encode(rgba, level.width, level.height, { normal: true });
      }
      return await encode(level.rgba, level.width, level.height);
    } finally {
      probe.add("webp", began);
      probe.count("webps");
    }
  };

  /* Файл `.webp` кэша: прочитать (учёт времени чтения) и записать (учёт времени записи). */
  const readCached = async (file, counter) => {
    const began = probe.now();
    const bytes = await fs.readFile(file).catch(() => null);
    probe.add("cacheRead", began);
    if (bytes) probe.count(counter);
    return bytes;
  };
  const writeCached = async (file, bytes) => {
    const began = probe.now();
    await fs.writeFile(file, bytes).catch(() => {});
    probe.add("cacheWrite", began);
  };

  const accept = acceptOf(input);
  /* Папка кэша блоков создаётся только тогда, когда пришла первая запись с блоками: без них в папке листов ничего нового. */
  const sheetCacheOf = async () => t.sheetCache || (await sheetCacheFor(cacheDir));
  const puts = [];

  /*
   * Лист для окна блоками (запись с `blocks`): кэш `bcn1` → лист → план → блоки или тот же WebP → ответ контейнером ASB1. Ключ кэша — тот же состав, что у `.webp`
   * (источник, имя, размер, отпечаток архива, карта), плюс форматы запроса и `|bcn1`. Запись в кэш ответ не ждёт; ей отдаётся копия: буфер ответа может уйти потоку
   * (передача без копирования), и пока он пишется на диск, отбирать его нельзя.
   */
  const keyTextOf = (request, stamp) => {
    const source = request.kind === "set" ? `${request.set}/${request.file}` : `${gameRoot.toLowerCase()}|${request.location}`;
    return `${source}|${request.name}|${request.size}|${stamp}${request.map ? `|${request.map}` : ""}`;
  };
  const blocksKeyOf = (keyText) => `${keyText}|${accept.join(",")}|bcn1`;
  /* Попадание в кэш блоков: ответ как есть (файл кэша с битом «из кэша»), или `null`. */
  const cachedBlocks = async (cacheKey) => {
    const lookedAt = probe.now();
    const hit = await (await sheetCacheOf()).getFile(cacheKey);
    probe.add("cacheRead", lookedAt);
    if (!hit) return null;
    probe.count("hitsBlocks");
    /* Вид нагрузки — байт 17: 1 — блоки, остальное — WebP внутри контейнера. */
    const how = { kind: hit[16 + 1] === 1 ? "blocks" : "webp", cached: true };
    hit[CACHED_FLAG_AT] |= 4;
    return { value: ownArrayBuffer(hit), state: SHEET_STATUS.ok, how };
  };

  const answerBlocks = async (request, keyText, webpFile) => {
    const cacheKey = blocksKeyOf(keyText);
    const sheetCache = await sheetCacheOf();
    const cached = await cachedBlocks(cacheKey);
    if (cached) return cached;
    const { ref, unreadable } = await locate(request);
    if (!ref) return { value: null, state: unreadable ? SHEET_STATUS.unavailable : SHEET_STATUS.absent };
    let container;
    let how = { kind: "blocks", cached: false };
    try {
      const { packSheets, sheetBlocks, sheetPlan } = await sheetBlocksModule();
      /* Лист мода — чёрный квадрат: тот же выбор листа, что у WebP (нужен разбор уровня, путь редкий — только `overMods`). */
      let chosen = ref;
      if (request.stock && sheetIsBlack(t.decode(ref, { maxSize: request.size }).rgba)) {
        const { ref: stockRef } = await locate(request.stock);
        if (stockRef) chosen = stockRef;
      }
      const plan = sheetPlan(chosen, { size: request.size, accept, map: request.map });
      if (plan.ok) {
        const began = probe.now();
        try {
          container = packSheets([sheetBlocks(chosen, plan)]);
        } catch {
          container = null;
        }
        probe.add("blocks", began);
      }
      if (!container) {
        /* Негодный лист: тот же WebP, что отдал бы путь без блоков (готовый `.webp` из старого кэша берётся как есть), в контейнере. */
        how = { kind: "webp", cached: false };
        let webp = await readCached(webpFile, "hitsWebp");
        if (webp) how.cached = true;
        else {
          webp = await renderSheetWebp(request, chosen, { stock: false });
          await writeCached(webpFile, webp);
        }
        container = packSheets([{ webp, lossless: Boolean(request.map) }]);
      }
    } catch {
      return { value: null, state: SHEET_STATUS.unavailable };
    }
    probe.count("putsBlocks");
    const putAt = probe.now();
    puts.push(sheetCache.put(cacheKey, container.slice()).then(() => probe.add("putAsync", putAt)));
    return { value: ownArrayBuffer(container), state: SHEET_STATUS.ok, how };
  };

  /*
   * Путь движка (`workshop-sheets-engine.js`, спецификация — `asb1-format.md`, раздел 11): запись с `blocks` при непустом `accept` (в окне включён выключатель сжатых листов), без
   * `overMods`, когда у движка есть команда. Сначала читатель смотрит свой кэш блоков `bcn1` по каждой такой записи: попадания отвечает сам, как путь JS (файл кэша с битом «из кэша»);
   * движок не зовётся и не поднимается, если промахов нет. Промахи уходят движку одной пачкой; он отвечает одним контейнером на пачку и списком листов, которых сам не отдаёт (`deferred`).
   * Контейнер режется на ответы по одной записи (`sheetFromBatch`) — форма и порядок ответа читателя прежние; отложенные листы, карты и записи без `blocks` идут прежним путём JS ниже, тем же
   * кодом. Движок читает и пишет те же файлы `bcn1` с тем же ключом. Любой отказ — промахи отвечаются читателем JS (`engine.fallbacks` в `timings`), попадания в кэш остаются; «команды нет»
   * выключает путь на сеанс (`noteFailure`). Возвращает `Map`: номер записи → `{ value, state, how }`, или `null`, если путь не годится.
   */
  async function serveFromEngine() {
    if (input?.overMods === true || accept.length === 0 || !requests.some((request) => request?.blocks)) return null;
    /* Подмена инструментов читателя (чтение игры, корни наборов, разбор — их ставят проверки) — это просьба идти ими, а движок читает настоящие файлы сам: без своего `sheetsEngine` он не берётся. */
    if (t.sheetsEngine === undefined && Object.keys(tools).length > 0) return null;
    const engine = t.sheetsEngine ?? (await sheetsEngineModule().then((module) => module.defaultSheetsEngine(), () => null));
    if (!engine || !engine.available()) return null;
    const began = probe.now();
    const served = new Map();
    const info = { calls: 0, prepMs: 0, ms: 0, readMs: 0, verifyMs: 0, sliceMs: 0, sheets: 0, deferred: 0, fallbacks: 0, cacheHits: 0, via: null, error: null, timings: null };
    /* Блок `engine` в `timings`: prepMs — файл запроса и рабочая папка вызова, ms — команда (строка процессу → ответ), readMs — получение контейнера (канал данных или файл),
       verifyMs — sha256 (только по просьбе), sliceMs — нарезка на ответы по листу; via — `http` или `file`; cacheHits — отвечено из кэша блоков до вызова. */
    const publish = () => {
      if (!probe.on) return;
      const round = Math.round;
      probe.engine = {
        calls: info.calls,
        prepMs: round(info.prepMs),
        ms: round(info.ms),
        readMs: round(info.readMs),
        ...(info.verifyMs ? { verifyMs: round(info.verifyMs) } : {}),
        sliceMs: round(info.sliceMs),
        sheets: info.sheets,
        deferred: info.deferred,
        fallbacks: info.fallbacks,
        cacheHits: info.cacheHits,
        ...(info.via ? { via: info.via } : {}),
        ...(info.error ? { error: info.error } : {}),
        timings: info.timings,
      };
    };
    try {
      /* Кэш блоков первым: записи, которым нужны блоки (без карт), и у которых есть отпечаток источника. */
      const candidates = [];
      for (const [index, one] of requests.entries()) if (one?.blocks && !one.map && (one.kind === "set" || gameRoot)) candidates.push(index);
      const misses = [];
      const cacheKeys = new Map();
      const sheetCache = await sheetCacheOf();
      await Promise.all(
        candidates.map(async (index) => {
          const one = requests[index];
          const stamp = await stampOf(one);
          if (!stamp) return;
          const cacheKey = blocksKeyOf(keyTextOf(one, stamp));
          cacheKeys.set(index, cacheKey);
          /* Промах узнаётся по оглавлению кэша в памяти — диск не читается. Файл, который положил движок мимо оглавления, считается промахом: движок отдаст его из своего чтения кэша,
             а оглавлению о нём подсказывает `note` ниже. */
          const hit = typeof sheetCache.has === "function" && !(await sheetCache.has(cacheKey)) ? null : await cachedBlocks(cacheKey);
          if (hit) {
            served.set(index, hit);
            info.cacheHits += 1;
          } else misses.push(index);
        }),
      );
      misses.sort((left, right) => left - right);
      if (misses.length === 0) {
        publish();
        return served;
      }
      const setRoots = {};
      for (const name of new Set(misses.flatMap((index) => (requests[index].kind === "set" ? [requests[index].set] : [])))) {
        const root = await t.setRoot(name);
        if (root) setRoots[name] = String(root);
      }
      const keys = gameRoot && misses.some((index) => requests[index].kind === "game") ? await archiveKeysDirectory({ keys: input?.keys, stateDir, provision: t.archiveSupport }) : undefined;
      const request = {
        ...(gameRoot ? { gameRoot } : {}),
        ...(keys ? { keys } : {}),
        accept: input.accept,
        textures: misses.map((index) => list[index]),
        setRoots,
        stateDir: path.dirname(cacheDir),
        ...(input?.share === false ? { share: false } : {}),
        ...(probe.on ? { timings: true } : {}),
        ...(t.engineFlush === true ? { flush: true } : {}),
        ...(Number.isInteger(t.engineThreads) ? { threads: t.engineThreads } : {}),
      };
      info.calls = 1;
      const reply = await engine.run({ request, cacheDir });
      const sliceAt = performance.now();
      const batch = reply.container;
      if (batch.length < 16 || new DataView(batch.buffer, batch.byteOffset, batch.byteLength).getUint32(8, true) !== misses.length)
        throw Object.assign(new Error("Число записей контейнера пачки не равно числу запросов."), { code: "SHEETS_BAD_CONTAINER" });
      const { ASB1, sheetFromBatch } = await sheetBlocksModule();
      const deferred = new Set(reply.deferred.map((item) => item.index));
      const fromEngine = new Map();
      for (const [at, index] of misses.entries()) {
        if (deferred.has(at)) continue;
        const part = sheetFromBatch(batch, at);
        if (!part) throw Object.assign(new Error("Запись контейнера пачки не разобралась."), { code: "SHEETS_BAD_CONTAINER" });
        if (part.status === "absent") fromEngine.set(index, { value: null, state: SHEET_STATUS.absent, how: null });
        else if (part.status === "unavailable") fromEngine.set(index, { value: null, state: SHEET_STATUS.unavailable, how: null });
        else fromEngine.set(index, { value: ownArrayBuffer(part.container), state: SHEET_STATUS.ok, how: { kind: part.kind === ASB1.KIND.bcn ? "blocks" : "webp", cached: (part.flags & ASB1.FLAG_CACHED) !== 0 } });
      }
      for (const [index, answerOf] of fromEngine) served.set(index, answerOf);
      /* Движок кладёт файлы кэша сам, мимо оглавления: листы, что он отдал (и свой кэш для них), записываются в оглавление подсказкой, чтобы следующая пачка узнала их без движка. */
      if (typeof sheetCache.note === "function")
        for (const [index, answerOf] of fromEngine) if (answerOf.state === SHEET_STATUS.ok && cacheKeys.has(index)) void sheetCache.note(cacheKeys.get(index), answerOf.value.byteLength);
      Object.assign(info, { prepMs: reply.prepMs, ms: reply.callMs, readMs: reply.readMs, verifyMs: reply.verifyMs, sliceMs: performance.now() - sliceAt, sheets: fromEngine.size, deferred: reply.deferred.length, via: reply.via, timings: reply.timings });
      publish();
      return served;
    } catch (error) {
      engine.noteFailure(error);
      Object.assign(info, { fallbacks: 1, error: String(error?.code || error?.name || "error"), ms: info.calls ? performance.now() - began : 0 });
      publish();
      return served;
    }
  }

  const result = [];
  const status = [];
  const answer = (value, state, how = null) => {
    result.push(value);
    status.push(state);
    probe.sheet(state, how);
  };
  try {
    const served = await serveFromEngine();
    /*
     * Кадр редактора арен — в текстурах поставленного мода (16.10): правка
     * соберётся поверх его файлов (`recolor-arenas.js`), и кадр показывает то
     * же. Лист, что есть в копии мода с тем же именем файла, берётся оттуда;
     * нет его там — из игры, как прежде.
     */
    if (input?.overMods === true && gameRoot) {
      const over = await (t.overModsOf || overModsOf)(stateDir, gameRoot).catch(() => new Map());
      for (const [index, request] of requests.entries()) {
        if (request?.kind !== "game") continue;
        const own = over.get(request.location.split("/").pop());
        if (!own) continue;
        const modded = { ...request, location: own.at.toLowerCase(), archive: "update", stock: request };
        if ((await texturesOf(modded)).some((item) => item.name.toLowerCase() === request.name)) requests[index] = modded;
      }
    }
    for (const [index, request] of requests.entries()) {
      const own = served?.get(index);
      if (own) {
        answer(own.value, own.state, own.how);
        continue;
      }
      if (!request) {
        answer(null, SHEET_STATUS.absent);
        continue;
      }
      if (request.kind === "game" && !gameRoot) {
        answer(null, SHEET_STATUS.unavailable);
        continue;
      }
      const stamp = await stampOf(request);
      if (!stamp) {
        answer(null, SHEET_STATUS.unavailable);
        continue;
      }
      const keyText = keyTextOf(request, stamp);
      const file = path.join(cacheDir, `${sha(keyText).slice(0, 32)}.webp`);
      if (request.blocks && accept.length) {
        const blocks = await answerBlocks(request, keyText, file);
        answer(blocks.value, blocks.state, blocks.how);
        continue;
      }
      const cached = await readCached(file, "hitsWebp");
      if (cached) {
        answer(asArrayBuffer(cached), SHEET_STATUS.ok, { kind: "webp", cached: true });
        continue;
      }
      const { ref, unreadable } = await locate(request);
      if (!ref) {
        answer(null, unreadable ? SHEET_STATUS.unavailable : SHEET_STATUS.absent);
        continue;
      }
      try {
        const bytes = await renderSheetWebp(request, ref);
        await writeCached(file, bytes);
        answer(asArrayBuffer(bytes), SHEET_STATUS.ok, { kind: "webp", cached: false });
      } catch {
        answer(null, SHEET_STATUS.unavailable);
      }
    }
  } finally {
    for (const entry of pinned) entry.pins -= 1;
    enforceBudget(session, budget);
    if (shared) releaseSession(session, idleMs);
    else {
      session.users -= 1;
      if (session.users === 0) await closeSession(session);
    }
  }
  const response = { textures: result, status };
  if (probe.on) {
    probe.set("queue", meta.queueMs || 0);
    probe.set("total", performance.now() - batchBegan);
    const report = probe.report({ share: shared });
    if (wantResponse) response.timings = report;
    if (process.env.ASTRAL_SHEETS_TIMINGS === "1") writeTimingsLine(cacheDir, report, puts, probe);
  }
  return response;
}

/*
 * Очередь чтения (профиль «до», 14.11.2026): окно отправляет все пачки листов сразу (`scene-textures.js`), а число одновременных держит читатель — первые `READ_SLOTS`
 * идут в работу, остальные ждут своей очереди по порядку прихода. Раньше окно держало в пути не больше восьми и следующую пачку слало из колбэка ответа на главном потоке:
 * тот занят кадрами, и читатель с тёплым кэшем (5–100 мс на пачку) простаивал. Восемь — прежняя нагрузка: каждая пачка открывает архивы игры заново (`game`), и больше
 * одновременных открытий читателю не нужно. Место переходит следующему сразу, без простоя; упавшая пачка место отдаёт.
 */
export const READ_SLOTS = 8;
let running = 0;
const waiting = [];
const acquire = () => {
  if (running < READ_SLOTS) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
};
const release = () => {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
};

export async function readWorkshopTextures(input, stateDir, tools = {}) {
  const asked = performance.now();
  await acquire();
  const queueMs = performance.now() - asked;
  try {
    return await readTextures(input, stateDir, tools, { queueMs });
  } finally {
    release();
  }
}
