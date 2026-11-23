/*
 * «Интерьеры проектов» (ТЗ 17.10.2026, вечер, задача 10) — каталог интерьеров
 * из файлов игрока.
 *
 * Сканер читает источник (`file-source.js`) и отвечает: какие интерьеры в нём
 * лежат, из каких файлов они состоят и чего им не хватает. Раскладка папок не
 * важна — их у проектов и у сборок разные, — поэтому интерьер находится по
 * содержимому, а не по именам папок:
 *
 *   1. каждый `.ytyp` разбирается: интерьер игры — архетип MLO со списком
 *      сущностей и комнат;
 *   2. каждая небольшая `.ymap` — где стоят экземпляры интерьеров;
 *   3. папка интерьера = общая папка его типов и карт, расширенная вверх, пока
 *      выше нет чужих интерьеров (`Animal_shelter/interior/…` +
 *      `Animal_shelter/placement/…` → `Animal_shelter`; интерьеры одного пака
 *      с общей картой сливаются в один);
 *   4. сущности интерьера сверяются по хешу имени модели: в его папке, в
 *      соседних папках источника («общие библиотеки пропсов») или в самой
 *      игре. Чего нет нигде — «не хватает»: на этом месте в игре будет пусто.
 *
 * Имена не общие на весь источник: в папке проекта лежат десятки паков, и
 * у разных паков бывают одноимённые вещи с разными определениями (другой
 * словарь листов, другая модель) и одноимённые MLO (одна больница в двух
 * локациях). Поэтому определение вещи берётся из папки самого интерьера или из
 * его пака (`pack-key.js`) — не из чужого: чужой файл типов не ставится, и в игре у
 * вещи штатное определение. Файлы моделей и листов, которых нет ни в паке, ни в
 * игре, ищутся и в остальных файлах источника (общие библиотеки пропсов), своего
 * пака — раньше чужих. Одноимённые MLO из разных паков — разные интерьеры; их
 * номер `p<hex>` может совпасть, как совпадает он и при сканировании каждого пака
 * по отдельности.
 *
 * Имена в типах и картах — хеши (`joaat`); человеку интерьер называет папка
 * (`label`, `category`), а стабильный номер даёт наименьший хеш его MLO —
 * один интерьер из россыпи файлов и из `dlc.rpf` сборки получает один номер.
 *
 * Игра нужна, чтобы отличить «модель в игре» от «модели нет нигде»; без неё
 * полнота не определяется (`state: "unknown"`).
 */

import { isProjectInteriorFileName, PROJECT_INTERIOR_MANIFEST_FILE } from "@modovik/install-engine/project-interiors-manifest-trust.js";
import { joaat, readMapData, readMapTypes } from "./meta.js";
import { LAYOUT_SEGMENT, ROOT_SEGMENT as ROOT_FOLDER, packKeyOf, packOfFile, packRootOf } from "./pack-key.js";

/* Меняется, когда меняется то, что сканер говорит об интерьерах: каталоги в кэше строятся заново. 4 — имена ищутся сначала в своём паке (17.10.2026), 5 — полнота говорит, сколько недостающих моделей нет в игре игрока (29.10.2026). */
export const SCAN_VERSION = 5;

const TYPES_LIMIT = 16 * 1024 * 1024;
const MAP_LIMIT = 4 * 1024 * 1024;
/* Карта размещения интерьера — килобайты; большая карта района места интерьера не определяет. */
const ANCHOR_MAP_LIMIT = 64 * 1024;
/* Карта размещения лежит рядом с типами: не дальше стольких папок вверх от папки типов (пак `Prison/interior/int_a` + `Prison/placement`). Дальняя карта — карта района игры, что ставит правленый штатный интерьер. */
const ANCHOR_REACH = 2;
/* Выше — в игру одним интерьером не ставится (update.rpf у игроков уже 3 ГБ из 4). */
export const INTERIOR_BYTES_LIMIT = 300 * 1024 * 1024;
const MODEL = /\.(ydr|ydd|yft)$/i;
const SHEET = /\.ytd$/i;
const BOUNDS = /\.ybn$/i;
const CLIP = /\.ycd$/i;
const DATA = /\.(ytyp|ymap|ymf)$/i;
/* Праздничные наложения места (GTA 5 RP: Halloween, Новый год): сервер включает их скриптом, в интерьер они не входят. */
const EVENT_FOLDER = /(^|\/)event_overlays(\/|$)/i;
/* Папки раскладки, что называют часть, а не интерьер. */
const GENERIC_FOLDER = new Set(["interior", "interiors", "placement", "props", "exterior", "files", "файлы", "pack_files", "dlc_паки", "x64", "levels", "gta5", "common", "data"]);

const dirOf = (file) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
const baseOf = (file) => file.slice(file.lastIndexOf("/") + 1);
const stemOf = (file) => baseOf(file).replace(/\.[^.]+$/, "");
const under = (file, dir) => dir === "" || file === dir || file.startsWith(`${dir}/`);
const packId = (segment) => /\[([^\]]+)\]\s*$/.exec(segment)?.[1]?.toLowerCase() || "";
const hex = (value) => (value >>> 0).toString(16).padStart(8, "0");

function commonDir(dirs) {
  if (!dirs.length) return "";
  const parts = dirs.map((dir) => (dir ? dir.split("/") : []));
  const first = parts[0];
  let length = first.length;
  for (const other of parts.slice(1)) {
    let at = 0;
    while (at < length && at < other.length && first[at] === other[at]) at += 1;
    length = at;
  }
  return first.slice(0, length).join("/");
}

/* Сколько общих папок в начале двух путей — близость файла к интерьеру. */
function closeness(file, dir) {
  const a = file.split("/");
  const b = dir ? dir.split("/") : [];
  let at = 0;
  while (at < a.length - 1 && at < b.length && a[at] === b[at]) at += 1;
  return at;
}

/** Человеческое имя папки интерьера: без хвоста `[имя_пака]` и подчёркиваний. */
export function interiorLabel(folder, fallback = "") {
  const raw = String(folder || fallback || "").trim();
  const clean = raw.replace(/\s*\[[^\]]*\]\s*$/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return clean || raw || "Интерьер";
}

/* Из двух копий файла (россыпью и в `dlc.rpf` сборки) берётся россыпь. */
function onePerName(files) {
  const byName = new Map();
  for (const file of files) {
    const key = baseOf(file.path).toLowerCase();
    const known = byName.get(key);
    if (!known || (known.archive && !file.archive)) byName.set(key, file);
  }
  return [...byName.values()];
}

/**
 * Каталог источника: `{ units, problems, stats }`. `game` —
 * `{ hasModel(хеш), hasSheet(хеш), hasName(имя файла строчными) }` или `null`.
 * `readTypes` / `readMap` подменяются тестом. `installFiles` — каталог для
 * установки (фаза 3): файлы интерьера сверяются ещё и с формой, которую примет
 * строгая проверка установки (один `_manifest.ymf`, допустимые имена).
 */
export async function scanSource(source, { game = null, readTypes = readMapTypes, readMap = readMapData, hash = joaat, installFiles = false } = {}) {
  const files = source.files.filter((file) => !EVENT_FOLDER.test(file.path));
  const problems = (source.unreadable || []).map((item) => ({ path: item.path, reason: item.code }));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const inArchive = (file) => byPath.get(file)?.archive === true;

  /*
   * 1. Типы: определения вещей и интерьеры. Определение вещи — на каждый файл типов
   * отдельно (у разных паков одноимённые вещи различаются); интерьер (MLO) — на пак:
   * одноимённые MLO одного пака (россыпь и копия в `dlc.rpf`) — один интерьер, из
   * разных паков — два.
   */
  const definitions = new Map();
  const mlos = new Map();
  const mlosByName = new Map();
  for (const file of files.filter((item) => /\.ytyp$/i.test(item.path) && item.size <= TYPES_LIMIT)) {
    let parsed;
    try {
      parsed = readTypes(await source.read(file.path));
    } catch (error) {
      problems.push({ path: file.path, reason: String(error?.message || error).slice(0, 80) });
      continue;
    }
    const pack = packOfFile(file.path);
    for (const archetype of parsed?.archetypes || []) {
      if (!definitions.has(archetype.name)) definitions.set(archetype.name, []);
      definitions.get(archetype.name).push({ archetype, file: file.path });
      if (!archetype.mlo) continue;
      const key = `${archetype.name}|${pack}`;
      const known = mlos.get(key);
      const better = !known || (archetype.entities?.length || 0) > (known.archetype.entities?.length || 0) || (known.file && inArchive(known.file) && !inArchive(file.path));
      if (better) mlos.set(key, { key, pack, hash: archetype.name, file: file.path, archetype, instances: known?.instances || [] });
      if (!mlosByName.has(archetype.name)) mlosByName.set(archetype.name, new Set());
      mlosByName.get(archetype.name).add(key);
    }
  }
  const signatureOf = (mlo) => `${mlo.archetype.entities?.length || 0}/${mlo.archetype.rooms?.length || 0}`;
  /*
   * Один пак лежит в локации двумя деревьями: россыпью (`файлы/<пак>`) и упакованным DLC
   * (`dlc_паки/<пак>/dlc.rpf`). Если в дереве из архивов нет ни одного MLO россыпью, а у
   * того же пака россыпью они есть, это упакованная копия пака, а не отдельные интерьеры
   * (локация ЛССД держит в `dlc_паки` весь DLC, россыпью — только его часть; остальное — это
   * интерьеры паков «Больница»). Её MLO в каталог не идут.
   */
  const rootsOfPack = new Map();
  for (const mlo of mlos.values()) {
    if (!rootsOfPack.has(mlo.pack)) rootsOfPack.set(mlo.pack, new Map());
    const roots = rootsOfPack.get(mlo.pack);
    const root = packRootOf(mlo.file);
    roots.set(root, (roots.get(root) || false) || !inArchive(mlo.file));
  }
  const forget = (mlo) => {
    mlos.delete(mlo.key);
    mlosByName.get(mlo.hash).delete(mlo.key);
  };
  for (const mlo of [...mlos.values()]) {
    const roots = rootsOfPack.get(mlo.pack);
    if (roots.size < 2 || roots.get(packRootOf(mlo.file))) continue;
    forget(mlo);
  }
  /*
   * Две упакованные копии одного пака (`dlcpacks/g_hayes` и `Hayes Auto [g_hayes]`, обе — только
   * `dlc.rpf`): тот же id пака и тот же состав — один интерьер. Остаётся тот, чья папка названа
   * человеком (скобки с id пака), иначе первая по пути. Одноимённые MLO паков с разным id — разные.
   */
  const looseRoots = new Set([...mlos.values()].filter((mlo) => !inArchive(mlo.file)).map((mlo) => packRootOf(mlo.file)));
  const copies = new Map();
  for (const mlo of mlos.values()) {
    const root = packRootOf(mlo.file);
    if (looseRoots.has(root)) continue;
    const last = root.slice(root.lastIndexOf("/") + 1);
    const key = `${mlo.hash}|${(packId(last) || last).toLowerCase()}|${signatureOf(mlo)}`;
    if (!copies.has(key)) copies.set(key, []);
    copies.get(key).push(mlo);
  }
  for (const list of copies.values()) {
    if (list.length < 2) continue;
    const named = (mlo) => (packId(packRootOf(mlo.file).split("/").pop()) ? 0 : 1);
    const [keep] = list.slice().sort((a, b) => named(a) - named(b) || packRootOf(a.file).localeCompare(packRootOf(b.file)));
    for (const mlo of list) if (mlo !== keep) forget(mlo);
  }
  if (!mlos.size) return { units: [], problems, stats: { files: files.length, interiors: 0 } };

  /* 2. Карты: где стоят экземпляры интерьеров. Карта называет MLO по имени — экземпляр записывается каждому одноимённому интерьеру, а «своих» среди них потом отбирает близость карты к типам. */
  for (const file of files.filter((item) => /\.ymap$/i.test(item.path) && item.size <= MAP_LIMIT)) {
    let map;
    try {
      map = readMap(await source.read(file.path));
    } catch (error) {
      problems.push({ path: file.path, reason: String(error?.message || error).slice(0, 80) });
      continue;
    }
    const pack = packOfFile(file.path);
    for (const entity of map?.entities || []) {
      /* Одноимённые интерьеры разных паков: карта принадлежит тому, чей пак она сама; нет такого — всем (общая карта района). */
      const named = [...(mlosByName.get(entity.archetype) || [])].map((key) => mlos.get(key));
      const own = named.filter((mlo) => packOfFile(mlo.file) === pack);
      for (const mlo of own.length ? own : named) mlo.instances.push({ file: file.path, position: entity.position, rotation: entity.rotation, anchor: file.size <= ANCHOR_MAP_LIMIT });
    }
  }

  /* 3. Папка каждого интерьера и слияние интерьеров одного пака. */
  const mloDirs = new Map();
  for (const mlo of mlos.values()) {
    let dir = dirOf(mlo.file);
    for (;;) {
      if (!mloDirs.has(dir)) mloDirs.set(dir, new Set());
      mloDirs.get(dir).add(mlo.key);
      if (!dir) break;
      dir = dirOf(dir);
    }
  }
  const roots = new Map();
  for (const mlo of mlos.values()) {
    /* Одну и ту же карту в сборке кладут по нескольку раз (россыпью, в `dlc.rpf`, в общей папке) — берутся карты ближайшей копии. */
    const own = dirOf(mlo.file);
    const reach = Math.max(0, own.split("/").filter(Boolean).length - ANCHOR_REACH);
    const near = mlo.instances.filter((instance) => instance.anchor && closeness(instance.file, own) >= reach);
    const best = Math.max(0, ...near.map((instance) => closeness(instance.file, own)));
    const anchors = near.filter((instance) => closeness(instance.file, own) === best);
    /* Выше папки своего пака интерьер не поднимается: копия пака в `dlc_паки/<пак>` не должна проглотить соседние паки локации. */
    const ceiling = packRootOf(mlo.file);
    let dir = commonDir([dirOf(mlo.file), ...anchors.map((instance) => dirOf(instance.file))]);
    if (!under(dir, ceiling)) dir = ceiling;
    /* Выше — пока в папке выше нет других интерьеров. */
    while (dir && dir !== ceiling) {
      const above = dirOf(dir);
      /* В корень источника не поднимаемся: папка пака — это папка, которую человек положил в источник. */
      if (!above) break;
      const inside = mloDirs.get(dir) || new Set();
      if (![...(mloDirs.get(above) || new Set())].every((other) => inside.has(other))) break;
      dir = above;
    }
    /* Папка раскладки пака (`exterior`, `placement`…) — часть пака, а не интерьер: интерьеры одного пака сходятся в его папку. */
    while (dir && dir !== ceiling && GENERIC_FOLDER.has(dir.slice(dir.lastIndexOf("/") + 1).toLowerCase())) dir = dirOf(dir);
    roots.set(mlo.key, dir);
  }
  /* Папка, в которую целиком попала другая, — один интерьер-пак. */
  const merged = new Map();
  for (const dir of [...new Set(roots.values())].sort((a, b) => a.split("/").length - b.split("/").length))
    if (![...merged.keys()].some((other) => under(dir, other))) merged.set(dir, new Set());
  for (const [mloKey, dir] of roots) [...merged].find(([other]) => under(dir, other))[1].add(mloKey);

  /* Файлы источника по хешу имени — для сверки моделей и словарей. */
  const modelIndex = new Map();
  const sheetIndex = new Map();
  for (const file of files) {
    const index = MODEL.test(file.path) ? modelIndex : SHEET.test(file.path) ? sheetIndex : null;
    if (!index) continue;
    const key = hash(stemOf(file.path));
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(file.path);
  }
  /* Ближайший к интерьеру файл; файлы его пака — раньше чужих. */
  const nearest = (paths, dir, packDir = "") =>
    paths.slice().sort((a, b) => Number(under(b, packDir) && packDir !== "") - Number(under(a, packDir) && packDir !== "") || closeness(b, dir) - closeness(a, dir))[0];

  const units = [];
  for (const [dir, mloKeys] of merged) {
    /* Интерьеры папки по возрастанию хеша: наименьший даёт номер. */
    const unitMlos = [...mloKeys].map((key) => mlos.get(key)).sort((a, b) => a.hash - b.hash);
    const packDir = packKeyOf(dir);
    const inUnit = onePerName(files.filter((file) => under(file.path, dir) && (MODEL.test(file.path) || SHEET.test(file.path) || BOUNDS.test(file.path) || CLIP.test(file.path) || DATA.test(file.path))));
    const own = new Set(files.filter((file) => under(file.path, dir)).map((file) => file.path));
    const kinds = { models: 0, sheets: 0, bounds: 0, clips: 0, data: 0 };
    let bytes = 0;
    for (const file of inUnit) {
      if (MODEL.test(file.path)) kinds.models += 1;
      else if (SHEET.test(file.path)) kinds.sheets += 1;
      else if (BOUNDS.test(file.path)) kinds.bounds += 1;
      else if (CLIP.test(file.path)) kinds.clips += 1;
      else kinds.data += 1;
      bytes += file.size;
    }

    /* 4. Полнота: сущности интерьеров — в папке, рядом, в игре или нигде. */
    const shared = new Set();
    const missingModels = new Set();
    /* Из недостающих моделей — вещи, определения которых нет ни в одном паке выгрузки: так ведёт себя штатная вещь более нового обновления GTA V, которого в игре игрока нет, или ресурс сервера, которого нет в выгрузке (по хешу не различить). */
    const missingNewer = new Set();
    const missingSheets = new Set();
    let vanilla = 0;
    let unknown = 0;
    let entities = 0;
    /* Порядок: файл в папке интерьера, затем штатный файл игры, затем файл другой папки источника (общая библиотека; своего пака — раньше чужих). */
    const found = (index, name, inGame) => {
      const paths = index.get(name);
      if (paths?.some((file) => own.has(file))) return "own";
      if (inGame) return "game";
      if (!paths) return game ? "missing" : "unknown";
      shared.add(nearest(paths, dir, packDir));
      return "shared";
    };
    /*
     * Определение вещи — из файлов типов, которые встанут в игру вместе с интерьером (его файлы без
     * копий: из двух одноимённых файлов ставится один, `onePerName`). Определения чужих паков не берутся:
     * чужой файл типов не ставится, и в игре у вещи штатное определение (имя вещи — имя модели). Чужое
     * определение подсовывало вещи чужой словарь листов, и интерьер выходил «неполным» (17.10.2026:
     * 12 паков GTA 5 РП, 8 — Majestic). Копия файла типов, которая не ставится (`occlusion.rpf/…` рядом
     * с `interiors/…`), определений не даёт.
     */
    const installed = new Set(inUnit.map((file) => file.path));
    const definitionOf = (name) => (definitions.get(name) || []).find((item) => installed.has(item.file))?.archetype || null;
    const modelState = (name) => found(modelIndex, name, Boolean(game?.hasModel(name)));
    const sheetState = (name) =>
      modelIndex.get(name)?.some((file) => own.has(file)) ? "own" : found(sheetIndex, name, Boolean(game && (game.hasSheet(name) || game.hasModel(name))));
    for (const mlo of unitMlos) {
      const wanted = [mlo.archetype.textureDictionary];
      for (const entity of mlo.archetype.entities || []) {
        entities += 1;
        const def = definitionOf(entity.archetype);
        /* Модель — по имени ресурса архетипа, иначе по имени самого архетипа. */
        const states = [...new Set([def?.assetName || entity.archetype, entity.archetype])].map(modelState);
        const state = states.find((item) => item !== "missing") || "missing";
        if (state === "game") vanilla += 1;
        else if (state === "unknown") unknown += 1;
        else if (state === "missing") {
          missingModels.add(entity.archetype);
          if (!definitions.has(entity.archetype)) missingNewer.add(entity.archetype);
        }
        wanted.push(def?.textureDictionary);
      }
      for (const sheet of new Set(wanted.filter(Boolean))) if (sheetState(sheet) === "missing") missingSheets.add(sheet);
    }
    const gaps = missingModels.size + missingSheets.size;
    const state = !game ? "unknown" : gaps === 0 ? "whole" : gaps <= 3 ? "few" : "many";

    /* Что ставить: потоковые файлы папки и соседние общие, данные карты. */
    const sharedFiles = [...shared].filter((file) => file && !own.has(file));
    const sharedBytes = sharedFiles.reduce((sum, file) => sum + (byPath.get(file)?.size || 0), 0);
    const names = [...new Set([...inUnit.map((file) => baseOf(file.path).toLowerCase()), ...sharedFiles.map((file) => baseOf(file).toLowerCase())])];
    const overrides = game ? names.filter((name) => game.hasName(name)) : [];
    const hei = names.filter((name) => /^hei_(?!prop_)/.test(name));
    /* Размещён ли: карта с ним лежит среди файлов интерьера — вне их она не встанет в игру вместе с ним. */
    const placed = unitMlos.some((mlo) => mlo.instances.some((instance) => own.has(instance.file)));
    const manifests = inUnit.filter((file) => /(^|\/)_manifest\.ymf$/i.test(file.path)).length;

    const blockers = [];
    if (state === "unknown") blockers.push("no-game");
    else if (state !== "whole") blockers.push("incomplete");
    if (overrides.length) blockers.push("overrides-game");
    if (hei.length) blockers.push("hei-files");
    if (!placed) blockers.push("no-placement");
    if (bytes + sharedBytes > INTERIOR_BYTES_LIMIT) blockers.push("too-big");
    if (!kinds.models && !sharedFiles.some((file) => MODEL.test(file))) blockers.push("no-models");
    /* Форма установки: причины о самих файлах называются, когда структурных причин нет — иначе это шум. */
    let badNames = [];
    if (installFiles && !blockers.length) {
      /* Чужие `.ymf` в контейнер не едут — только его собственный манифест. */
      badNames = names.filter((name) => (!name.endsWith(".ymf") || name === PROJECT_INTERIOR_MANIFEST_FILE) && !isProjectInteriorFileName(name));
      if (manifests !== 1) blockers.push("no-manifest");
      if (badNames.length) blockers.push("bad-names");
    }

    /* Имя человеку даёт папка локации (`Арена`), а не пак внутри её `файлы/mj_hw_addon`, — когда в локации один пак. Папка интерьера (`dir`) остаётся своей: ставится она. */
    const layoutAt = dir.split("/").findIndex((segment) => LAYOUT_SEGMENT.test(segment));
    const location = layoutAt > 0 ? dir.split("/").slice(0, layoutAt).join("/") : "";
    const labelDir = location && ![...merged.keys()].some((other) => other !== dir && under(other, location)) ? location : dir;
    const segments = labelDir ? labelDir.split("/") : [];
    const named = segments.filter((segment) => !GENERIC_FOLDER.has(segment.toLowerCase()) && !/\.rpf$/i.test(segment));
    /* `Bloods [mj_location_bloods]/…/mj_location_bloods` — внутренняя папка с тем же именем пака не называет интерьер заново. */
    while (named.length > 1 && packId(named[named.length - 2]) === named[named.length - 1].toLowerCase()) named.pop();
    const first = (unitMlos[0].instances.find((instance) => own.has(instance.file)) || unitMlos[0].instances[0])?.position || null;
    units.push({
      id: `p${hex(unitMlos[0].hash)}`,
      slug: `astral_proj_${hex(unitMlos[0].hash)}`,
      label: interiorLabel(named[named.length - 1], source.label),
      category: named.slice(0, -1).filter((segment) => !ROOT_FOLDER.has(segment.toLowerCase())),
      dir,
      mlo: unitMlos.map((mlo) => ({
        hash: mlo.hash,
        rooms: mlo.archetype.rooms?.length || 0,
        entities: mlo.archetype.entities?.length || 0,
        placed: mlo.instances.length,
      })),
      position: first ? first.map((value) => Math.round(value * 10) / 10) : null,
      files: { ...kinds, bytes, sharedBytes, shared: sharedFiles.length, manifests },
      completeness: { state, entities, vanilla, unknown, missingModels: missingModels.size, missingNewer: missingNewer.size, missingSheets: missingSheets.size, shared: sharedFiles.length },
      install: { offered: blockers.length === 0, blockers, overrides: overrides.slice(0, 8), hei: hei.slice(0, 8), ...(badNames.length ? { names: badNames.slice(0, 8) } : {}) },
      /* Только главному процессу: что и откуда ставить. */
      internal: {
        source: source.label,
        files: inUnit.map((file) => file.path),
        shared: sharedFiles,
        types: [...new Set(unitMlos.map((mlo) => mlo.file))],
        /* Чего не нашлось ни в паке, ни рядом, ни в игре: хеши имён моделей и словарей листов — их ищут в других паках (`scripts/probe-majestic-dump.mjs --missing`). */
        missing: { models: [...missingModels].map((hash) => hex(hash)), newer: [...missingNewer].map((hash) => hex(hash)), sheets: [...missingSheets].map((hash) => (typeof hash === "number" ? hex(hash) : String(hash))) },
      },
    });
  }
  units.sort((a, b) => a.category.join("/").localeCompare(b.category.join("/")) || a.label.localeCompare(b.label));
  return { units, problems, stats: { files: files.length, interiors: mlos.size } };
}

/** Что уходит окну: без списков файлов. */
export function publicUnit(unit) {
  const { internal: _internal, ...rest } = unit;
  return rest;
}
