/*
 * Большая карта: чтение из игры и установка обратно.
 *
 * Окно рисует карту и сжимает её в DDS; здесь она превращается в патч архива и
 * уезжает тем же установщиком RPF, что и прицел с мини-картой, — с проверкой
 * до записи, точкой отката и полным backup `update.rpf`.
 *
 * Плитки приезжают из окна по одной и складываются в сессию на диске. Так
 * сделано не ради красоты: карта в 4K — это шесть плиток по три мегабайта, и
 * один вызов с ними целиком означал бы двадцать мегабайт строки в IPC и
 * непонятный человеку прогресс. Сессия заодно снимает вопрос путей: окно
 * никогда не называет файл на диске, оно называет плитку.
 */

import { ensureStoredFile } from "@modovik/install-engine/chunk-store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ASI_LOADERS, MODS_PLUGINS } from "./game-archive-layer.js";
import { discoverGames } from "@modovik/game-discovery";
import { readStateShared } from "@modovik/install-engine/engine-state.js";
import {
  getAstralLayerStatus,
  WORLD_MAP_ISLAND_ENTRY,
  WORLD_MAP_ISLAND_SOURCE,
  WORLD_MAP_PAUSE_ENTRY,
  WORLD_MAP_PAUSE_SOURCE,
  WORLD_MAP_RADAR_OVERLAY_ARCHIVE,
  WORLD_MAP_RADAR_OVERLAY_DIRECTORY,
  WORLD_MAP_RADAR_TILES_ENTRY,
  WORLD_MAP_RADAR_TILES_SOURCE,
  WORLD_MAP_RADAR_TUNABLES_ENTRY,
  WORLD_MAP_RADAR_TUNABLES_SOURCE,
  WORLD_MAP_ZOOM_ENTRY,
  WORLD_MAP_ZOOM_SOURCE,
  engineInstallEnabled,
  inspectProfile,
  installLocalWorldMapPackage,
  planLocalWorldMapPackage,
  sha256File,
  uninstallPackage,
  worldMapSourceDigest,
} from "@modovik/install-engine";
import {
  MAP_ZOOM_ENTRY_LEVEL,
  RADAR_BIGMAP_STOCK_FIELDS,
  RADAR_TILT_STRENGTH,
  blockHeightGrid,
  buildMapZoomMeta,
  classifyRadarColour,
  normalizeMapZoom,
  radarCarFields,
} from "@modovik/vector-map";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { patchPsoField, readPsoField } from "@modovik/optimizer/pso.js";
import { createGameReader } from "./game-archive-reader.js";
import { callNativeEngine } from "./native-engine.js";
import { resolveGameScaleformBase } from "./game-scaleform-base.js";
import {
  resolveStockWorldMap,
  stockWorldMapStatus as describeStockWorldMap,
} from "./world-map-stock.js";
import {
  PAUSE_MAP_GFX_ENTRY,
  compilePauseMapGfx,
  verifyPauseMapBase,
} from "./pause-map-gfx-compiler.js";
import { buildPauseBlurFile } from "./pause-menu-blur.js";
import { buildRadarMaskFile } from "./radar-mask.js";
import {
  ISLAND_MAP_BASE,
  compileIslandGfx,
  readIslandMapPalette,
} from "./island-map-gfx.js";
import { describeLiveWorldMap } from "./world-map-live.js";
import {
  composeRpfArchive,
  createRpfArchive,
  extractRpfEntry,
  installRpfPrebuilt,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import {
  archiveKeysDirectory,
  provisionArchiveSupport,
} from "./loader-provisioner.js";

/*
 * Нативный хост и поставщик ArchiveFix подставляются снаружи. Это не абстракция
 * ради абстракции: собрать хост можно только под Windows, а проверять сессию
 * выгрузки, границы плиток и порядок вызовов нужно на любой машине.
 */
const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  /* Установка движком за флагом `ASTRAL_ENGINE_INSTALL=world-map-customizer`: `compose-rpf` с блоком `install`. */
  installPrebuilt: installRpfPrebuilt,
  /* Движок и его помощники подставляются снаружи по той же причине: план и
     установку карты нужно проверять без helper и без игры. */
  engine: {
    plan: planLocalWorldMapPackage,
    install: installLocalWorldMapPackage,
    uninstall: uninstallPackage,
  },
  composer: {
    rpfComposer: composeRpfArchive,
    rpfProbe: probeRpfArchive,
    /* Контейнер пустых плиток радара собирает тот же помощник, что и
       архивы DLC. */
    rpfCreate: createRpfArchive,
    contentXmlProvider: provideUpdateContentXml,
    dlcListProvider: provideLegacyDlcList,
  },
  discoverGames,
  /* Текстовый файл игры по записи архива. Подставляется снаружи по той же
     причине, что и остальное: helper есть не на каждой машине. */
  /* Состояние профиля и слой Astral: по ним видно, какой архив движок
     считает основой (`tileBaseArchive`). Подставляются снаружи, как и всё
     остальное, — иначе чтение карты нельзя было бы проверить без игры. */
  readState: readStateShared,
  layerStatus: getAstralLayerStatus,
  /* Штатные плитки радара из игры — дополнить ими контейнер (`buildRadarFiles`). */
  readStockRadarTiles,
  /* `minimap.ymt`, что игра читает сейчас, и штатный — вернуть штатные поля растра (`radarTunablesRepair`). */
  readRadarTunables,
  /* Какая карта стоит в игре сейчас: вес и плитка (`world-map-live.js`). */
  describeLive: describeLiveWorldMap,
  /* Штатная карта Rockstar — из игры игрока по порядку доверия и из памяти
     (`world-map-stock.js`). Подставляется снаружи: в тестах и там, где
     помощника нет, штатной карты «нет нигде», и это допустимый ответ. */
  stock: {
    resolve: resolveStockWorldMap,
    status: describeStockWorldMap,
  },
  readGameText: async ({ gameRoot, archive, entry, output }) => {
    await extractRpfEntry({
      archivePath: path.join(gameRoot, archive),
      entry,
      output,
      gameRoot,
      edition: "Legacy",
    });
    return fs.readFile(output, "utf8");
  },
  /* То же, но байтами: эффекты экрана — двоичный PSO (`pause-menu-blur.js`). */
  readGameBytes: async ({ gameRoot, archive, entry, output }) => {
    await extractRpfEntry({
      archivePath: path.join(gameRoot, archive),
      entry,
      output,
      gameRoot,
      edition: "Legacy",
    });
    return fs.readFile(output);
  },
  /* Штатный фильм карты паузы — из игры игрока, тем же порядком доверия,
     что у мини-карты и прицела (`game-scaleform-base.js`). */
  pauseMapBase: ({ gameRoot, stateDir }) =>
    resolveGameScaleformBase({ gameRoot, stateDir }, PAUSE_MAP_BASE),
  /* Штатный фильм острова Кайо-Перико — оттуда же, тем же порядком доверия
     (`island-map-gfx.js`). */
  islandMapBase: ({ gameRoot, stateDir }) =>
    resolveGameScaleformBase({ gameRoot, stateDir }, ISLAND_MAP_BASE),
});

/*
 * Карта паузы собирается поверх фильма самого игрока: файлов Rockstar в
 * поставке нет, а чужая копия не совпала бы с его сборкой игры. База
 * проверяется по устройству (`verifyPauseMapBase`), а не по хешу.
 */
const PAUSE_MAP_BASE = Object.freeze({
  memory: "pause-map-bases",
  files: Object.freeze([
    { key: "gfx", entry: PAUSE_MAP_GFX_ENTRY, extension: "gfx" },
  ]),
  /* Фильм карты из каталога — чужой мод: тогда база берётся сперва из
     резервной копии. Свой пакет карты живёт в том же архиве, и его запись
     тоже считается занятой — база возьмётся из копии до установки. */
  catalogOwns: (entry) => entry === PAUSE_MAP_GFX_ENTRY.toLowerCase(),
  verify: ({ gfx }) => verifyPauseMapBase(gfx),
  memoryLabel: "проверенный ранее фильм карты паузы этой игры",
  missing: "в архиве нет minimap_main_map.gfx",
  notFound:
    "Не удалось найти штатный фильм карты паузы, поверх которого красится море и убираются контуры.",
});

/** Атлас большой карты — единицы плиток; больше означает подделку. */
const MAX_TILES = 24;

/** Плитка 6144×6144 в BC1 с мипами — двадцать пять мегабайт (4096 в BC3 у карт прежних версий — двадцать один). */
const MAX_TILE_BYTES = 32 * 1024 * 1024;

/*
 * Штатные ступени приближения лежат в `common.rpf`; в `update.rpf` файла нет,
 * пока его не положит мод. Основой служит именно штатный: файл в `update.rpf`
 * может быть нашим же от прошлой установки, и отдаление, посчитанное от него,
 * копилось бы с каждым «Применить».
 */
const ZOOM_BASE = Object.freeze({
  archive: "common.rpf",
  entry: "data/ui/mapzoomdata.meta",
});
/* Тот же файл поверх — в update.rpf: его кладут мини-карта из мастерской и
   моды отдаления. Читается ради ступеней радара, которые карта не трогает. */
const ZOOM_LIVE = Object.freeze({
  archive: "update/update.rpf",
  entry: "common/data/ui/mapzoomdata.meta",
});

/** Имя плитки задаёт сама игра; своё сюда попасть не должно. */
const TILE_NAME = /^minimap(_sea)?_\d+_\d+\.ytd$/i;

/** Идентификатор сессии выдаём мы, поэтому проверка простая и строгая. */
const SESSION_ID = /^[0-9a-f]{32}$/;

const stagingRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "world-map-sessions");

const cacheRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "world-map-tiles");

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected))
    throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

/*
 * Ключ кэша — сама папка игры, но хешем: путь содержит имя пользователя
 * Windows, а имена в кэше попадают в логи и отчёты о сбоях.
 */
const cacheKey = (gameRoot) =>
  createHash("sha256")
    .update(path.resolve(gameRoot).toLowerCase())
    .digest("hex")
    .slice(0, 16);

function requireSession(input) {
  const session = String(input?.session || "").trim();
  if (!SESSION_ID.test(session)) throw new Error("Некорректная сессия карты.");
  return session;
}

function decodeTile(value) {
  const encoded = String(value || "");
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded))
    throw new RangeError("Плитка карты передана не как base64.");
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > MAX_TILE_BYTES)
    throw new RangeError("Плитка карты пустая или слишком большая.");
  if (buffer.toString("base64") !== encoded)
    throw new Error("Плитка карты передана в неканоническом base64.");
  // Заголовок DDS: четыре байта «DDS » и размер структуры 124.
  if (buffer.readUInt32LE(0) !== 0x20534444 || buffer.readUInt32LE(4) !== 124)
    throw new Error("Плитка карты не является DDS.");
  return buffer;
}

function requireTileName(value) {
  const name = String(value || "").trim();
  if (!TILE_NAME.test(name) || path.basename(name) !== name)
    throw new Error(`Недопустимое имя плитки: ${name}`);
  return name.toLowerCase();
}

/** Открывает сессию выгрузки карты и отдаёт окну её идентификатор. */
export async function beginWorldMapExport(_input, _context, stateDir) {
  const session = randomUUID().replaceAll("-", "");
  const directory = path.join(stagingRoot(stateDir), session);
  await fs.mkdir(directory, { recursive: true });
  return { session };
}

/**
 * Кладёт в сессию одну плитку карты — или, если пришло поле `overlay`, один
 * кусок слоёв мини-карты (`stageRadarOverlay`): канал один, потому что у обоих
 * одна сессия и один предел размера.
 * Возвращает, сколько плиток уже принято.
 */
export async function stageWorldMapTile(input, _context, stateDir) {
  const session = requireSession(input);
  const directory = path.join(stagingRoot(stateDir), session);
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("Сессия карты не открыта.");
  if (input?.overlay !== undefined) return stageRadarOverlay(input, directory, session);
  const name = requireTileName(input?.name);
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".dds"));
  if (files.length >= MAX_TILES && !files.includes(`${name}.dds`))
    throw new Error("Слишком много плиток в одной карте.");
  await fs.writeFile(
    path.join(directory, `${name}.dds`),
    decodeTile(input?.dds),
  );
  return {
    session,
    staged: (await fs.readdir(directory)).filter((file) => file.endsWith(".dds")).length,
  };
}

/*
 * Слои большой карты на мини-карте: куски файла «ARO1» (`radar-overlay.js`),
 * по одному на вызов. Лежат в своей папке сессии, чтобы не считаться плитками.
 * Хост файлам не верит и проверяет их сам, но то, что не похоже на файл слоёв,
 * отсекается здесь — и ещё до диска: метка, версия, длина по заголовку.
 */
const OVERLAY_DIRECTORY = "radar-overlay";
const MAX_OVERLAY_CHUNKS = 64;
const MAX_OVERLAY_BYTES = 25 * 1024 * 1024;
const OVERLAY_MAGIC = 0x314f5241;

function decodeOverlay(value) {
  const encoded = String(value || "");
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded))
    throw new RangeError("Слои мини-карты переданы не как base64.");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < 16 || buffer.length > MAX_OVERLAY_BYTES)
    throw new RangeError("Слои мини-карты пустые или слишком большие.");
  if (buffer.toString("base64") !== encoded)
    throw new Error("Слои мини-карты переданы в неканоническом base64.");
  if (buffer.readUInt32LE(0) !== OVERLAY_MAGIC || buffer.readUInt32LE(4) !== 1)
    throw new Error("Слои мини-карты не в формате ARO1.");
  const vertices = buffer.readUInt32LE(8);
  const indices = buffer.readUInt32LE(12);
  if (indices % 3 || buffer.length !== 16 + vertices * 16 + indices * 4)
    throw new Error("Длина слоёв мини-карты не сходится с заголовком.");
  return buffer;
}

async function stageRadarOverlay(input, directory, session) {
  const index = Number(input?.index);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_OVERLAY_CHUNKS)
    throw new Error("Номер куска слоёв мини-карты недопустим.");
  const buffer = decodeOverlay(input.overlay);
  const folder = path.join(directory, OVERLAY_DIRECTORY);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, `${String(index).padStart(3, "0")}.aro`), buffer);
  return { session, overlay: (await fs.readdir(folder)).length };
}

/** Куски слоёв сессии по порядку: полные пути для хоста. */
async function sessionOverlays(session, stateDir) {
  const folder = path.join(stagingRoot(stateDir), session, OVERLAY_DIRECTORY);
  const files = (await fs.readdir(folder).catch(() => [])).filter((file) => file.endsWith(".aro")).sort();
  return files.map((file) => path.join(folder, file));
}

/** Закрывает сессию и убирает её файлы. */
export async function endWorldMapExport(input, _context, stateDir) {
  const session = requireSession(input);
  await fs
    .rm(path.join(stagingRoot(stateDir), session), {
      recursive: true,
      force: true,
    })
    .catch(() => {});
  return { session, released: true };
}

async function sessionTiles(session, stateDir) {
  const directory = path.join(stagingRoot(stateDir), session);
  const files = (await fs.readdir(directory).catch(() => [])).filter((file) =>
    file.endsWith(".dds"),
  );
  if (!files.length) throw new Error("В сессии нет ни одной плитки карты.");
  return files
    .map((file) => `${file.slice(0, -4)}=${path.join(directory, file)}`)
    .sort();
}

/*
 * Откуда брать карту игрока — и для окна, и для сборки патча.
 *
 * Плитки лежат в `update/update.rpf`, и туда же Astral пишет свою карту.
 * После первой же установки живой архив несёт уже НАШУ карту: редактор
 * показывал её как «карту из игры», шаблон «Как в игре» возвращал её же, и
 * каждое применение впекало прошлый вид в следующий. Ратчет.
 *
 * Основой должен быть тот архив, поверх которого движок собирает слои, —
 * `compositionBase` профиля. Пока ничего не установлено, это тот же живой
 * файл; как только карта встала, это копия до неё. Тогда «Как в игре» —
 * действительно карта Rockstar (или чужой графический мод игрока, если он
 * стоял до Astral: его игра, его основа).
 *
 * Тем же архивом собирается патч: словарь текстур, формат и флаги новой
 * плитки берутся у той же плитки, которую человек видел в окне.
 */
async function tileBaseArchive({ gameRoot, stateDir }, tools) {
  try {
    const state = await tools.readState(stateDir);
    const targets = Object.values(state?.targets || {});
    const target = targets.find(
      (item) =>
        path.resolve(String(item?.gameRoot || "")).toLowerCase() ===
        path.resolve(gameRoot).toLowerCase(),
    );
    if (!target?.id) return null;
    const status = await tools.layerStatus({ targetId: target.id, stateDir });
    const base = status?.backup?.path;
    if (!base) return null;
    await ensureStoredFile(base);
    const stat = await fs.stat(base).catch(() => null);
    if (!stat?.isFile()) return null;
    return { path: base, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
  } catch {
    /* Профиль ещё не заведён или состояние не читается — основой остаётся
       живой архив: это и есть игра человека до всякого Astral. */
    return null;
  }
}

async function buildPatch(input, context, stateDir, native, tools) {
  const gameRoot = requireGameRoot(input);
  const session = requireSession(input);
  const tiles = await sessionTiles(session, stateDir);
  const output = path.join(stagingRoot(stateDir), session, "patch");
  await fs.rm(output, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(output, { recursive: true });
  /*
   * Ключи нужны и здесь: патч собирается по архиву игрока, и без набора сборка
   * падает тем же «could not discover the RPF keys», что и чтение. Ключи
   * получало чтение и получала запись — а шаг между ними шёл без них, и на
   * свежей сборке до записи было просто не дойти.
   */
  const keys = await archiveKeys(input, stateDir, tools);
  /* Словарь текстур и флаги новой плитки клонируются с плитки-образца.
     Образец — та же плитка, что человек видел в окне: штатная, если она
     нашлась, иначе из основы движка. */
  const base = await patchBaseArchive({ gameRoot, stateDir, context }, tools);
  const built = await native(
    "build-map-patch",
    { gameRoot, output, tiles, keys, baseArchive: base || null },
    context,
  );
  return { gameRoot, session, patch: output, built };
}

async function patchBaseArchive({ gameRoot, stateDir, context }, tools) {
  const stock = await tools.stock
    .resolve({ gameRoot, stateDir, context }, tools)
    .catch(() => null);
  if (stock?.archivePath) {
    const stat = await fs.stat(stock.archivePath).catch(() => null);
    if (stat?.isFile()) return stock.archivePath;
  }
  const base = await tileBaseArchive({ gameRoot, stateDir }, tools);
  return base?.path || null;
}

/*
 * Плитка лежит ровно там, куда её кладёт игра: вложенный
 * `scaleform_generic.rpf` внутри `update/update.rpf`. Тот же путь целит реестр
 * `large-map` в @modovik/mod-targets и траст движка; здесь он повторён, чтобы
 * чужая карта, лежащая в другом архиве, получила понятный отказ до движка.
 */
const TILE_ENTRY =
  /^x64\/data\/cdimages\/scaleform_generic\.rpf\/(minimap(?:_sea)?_\d{1,2}_\d{1,2}\.ytd)$/i;
const WORLD_MAP_MOD_ID = /^local-legacy-world-map-[a-f0-9]{12}$/;

/*
 * Что окно просит сделать с приближением карты.
 *
 * `vectorLayer: false` — человек изменил карту, и штатный векторный слой игры
 * обязан уйти с карты паузы, иначе при приближении он закроет её собой
 * (подробно — `@modovik/vector-map/mapzoom.js`). Молчание окна значит «как
 * было»: слой выключается только явным отказом, а не отсутствием поля.
 */
function zoomRequest(input) {
  const zoom = normalizeMapZoom(input?.zoom);
  const vector = input?.vectorLayer !== false;
  return { zoom, vector, needed: !vector || zoom.distance > 1 };
}

/**
 * Файл ступеней приближения под проект — в ту же папку, что и плитки.
 * Возвращает запись манифеста и то, что получилось, — для сводки в окне.
 */
async function buildZoomFile(request, gameRoot, packageRoot, tools) {
  if (!request.needed) return null;
  const scratch = path.join(packageRoot, "zoom-base.meta");
  const scratchLive = path.join(packageRoot, "zoom-live.meta");
  /* Штатный файл не прочитался — не повод отказывать в установке: файл
     собирается из штатных чисел, и окно узнаёт об этом из сводки. */
  const base = await tools
    .readGameText({ gameRoot, ...ZOOM_BASE, output: scratch })
    .catch(() => null);
  /* Файл, который уже лежит в update.rpf, — источник ступеней радара:
     мини-карта из мастерской хранит в нём свою дальность, и карта обязана
     её сберечь. Нет файла — нет и чужих ступеней. */
  const live = await tools
    .readGameText({ gameRoot, ...ZOOM_LIVE, output: scratchLive })
    .catch(() => null);
  await Promise.all([
    fs.rm(scratch, { force: true }).catch(() => {}),
    fs.rm(scratchLive, { force: true }).catch(() => {}),
  ]);
  const built = buildMapZoomMeta(base, request.zoom, {
    vector: request.vector,
    live,
  });
  const bytes = Buffer.from(built.xml, "utf8");
  const target = path.join(packageRoot, "payload", "mapzoomdata.meta");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return {
    file: {
      source: WORLD_MAP_ZOOM_SOURCE,
      target: "update/update.rpf",
      action: "upsert",
      entry: WORLD_MAP_ZOOM_ENTRY,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    summary: {
      distance: request.zoom.distance,
      openScale: built.levels[MAP_ZOOM_ENTRY_LEVEL].scale,
      vectorLayer: request.vector,
      base: built.source,
    },
  };
}

/*
 * Что окно просит сделать с фильмом карты паузы: убрать штатные контуры
 * поверх плиток и покрасить море. Молчание окна — «как в игре»: файл не
 * собирается и в пакет не попадает.
 */
const SEA_COLOR = /^#[0-9a-f]{6}$/i;

function pauseMapRequest(input) {
  const source =
    input?.pauseMap && typeof input.pauseMap === "object"
      ? input.pauseMap
      : {};
  const hideOverlays = source.hideOverlays === true;
  const seaColor = source.seaColor
    ? String(source.seaColor).trim().toLowerCase()
    : null;
  if (seaColor && !SEA_COLOR.test(seaColor))
    throw new Error("Цвет моря карты паузы задан не в виде #rrggbb.");
  const noSea = source.noSea === true;
  return { hideOverlays, seaColor, noSea, needed: hideOverlays || noSea || Boolean(seaColor) };
}

/*
 * Размытие за картой паузы (15.10): `pauseMap.blur === false` — убрать.
 * Молчание окна — «как в игре»: файла эффектов в пакете нет.
 */
const pauseBlurRequest = (input) => input?.pauseMap?.blur === false;

async function buildPauseBlur(input, gameRoot, packageRoot, stateDir, tools) {
  if (!pauseBlurRequest(input)) return null;
  return buildPauseBlurFile({ gameRoot, packageRoot, stateDir }, tools);
}

/**
 * Фильм карты паузы под проект — в ту же папку, что и плитки. Основа —
 * штатный файл из игры игрока; правится он по устройству
 * (`pause-map-gfx-compiler.js`). Возвращает запись манифеста и сводку.
 */
async function buildPauseMapFile(request, gameRoot, packageRoot, stateDir, tools) {
  if (!request.needed) return null;
  /*
   * Окно с 17.10 просит фильм всегда — с морем, запечённым в непрозрачные
   * плитки паузы (`pauseMapInstallPlan`). Когда это единственная просьба
   * (контуры не трогаются), фильм — подстраховка от шва у игрока со своим
   * морем, и пропавшая основа не повод отказать в установке карты.
   */
  const base = request.hideOverlays
    ? await tools.pauseMapBase({ gameRoot, stateDir })
    : await tools.pauseMapBase({ gameRoot, stateDir }).catch(() => null);
  if (!base) return null;
  const compiled = compilePauseMapGfx(await fs.readFile(base.gfxFile), {
    hideOverlays: request.hideOverlays,
    seaColor: request.seaColor,
    noSea: request.noSea,
  });
  const target = path.join(packageRoot, "payload", "minimap_main_map.gfx");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, compiled.buffer);
  return {
    file: {
      source: WORLD_MAP_PAUSE_SOURCE,
      target: "update/update.rpf",
      action: "replace",
      entry: WORLD_MAP_PAUSE_ENTRY,
      size: compiled.buffer.length,
      sha256: compiled.sha256,
    },
    summary: {
      hideOverlays: request.hideOverlays,
      hiddenOverlays: compiled.hiddenOverlays,
      seaColor: compiled.seaColor,
      noSea: compiled.noSea,
      base: base.source,
    },
  };
}

/*
 * Остров Кайо-Перико (19.10.2026): окно называет пары «было → стало» по
 * палитре фильма острова (`readIslandMap`), главный процесс красит заливки
 * фильма из файла игрока (`island-map-gfx.js`). Пустых пар не бывает: цвета не
 * изменились — остров остаётся штатным, и файла в пакете нет.
 */
const ISLAND_COLOUR = /^[0-9A-F]{8}=[0-9A-F]{8}$/;

function islandRequest(input) {
  const raw =
    input?.island && typeof input.island === "object" && Array.isArray(input.island.colours)
      ? input.island.colours
      : [];
  const colours = [];
  for (const item of raw) {
    const pair = String(item || "").toUpperCase();
    if (!ISLAND_COLOUR.test(pair))
      throw new Error(`Цвет острова записан не цветом: ${item}`);
    colours.push(pair);
  }
  if (colours.length > 256) throw new Error("Слишком много цветов для острова.");
  return { colours, needed: colours.length > 0 };
}

/**
 * Фильм острова под проект — в ту же папку, что и плитки. Основа — штатный
 * файл из игры игрока. Нет острова в этой игре или основа не нашлась — карта
 * всё равно ставится, а причина уходит в итог: остров — добавка, а не повод
 * отказать в установке карты.
 */
async function buildIslandFile(request, gameRoot, packageRoot, stateDir, tools) {
  if (!request.needed) return null;
  let base;
  try {
    base = await tools.islandMapBase({ gameRoot, stateDir });
  } catch (error) {
    return {
      file: null,
      summary: { painted: false, reason: "no-base", message: String(error?.message || error).slice(0, 400) },
    };
  }
  const compiled = compileIslandGfx(await fs.readFile(base.gfxFile), { colours: request.colours });
  const target = path.join(packageRoot, "payload", "int3232302352.gfx");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, compiled.buffer);
  return {
    file: {
      source: WORLD_MAP_ISLAND_SOURCE,
      target: "update/update.rpf",
      action: "replace",
      entry: WORLD_MAP_ISLAND_ENTRY,
      size: compiled.buffer.length,
      sha256: compiled.sha256,
    },
    summary: { painted: true, reason: "", changed: compiled.changed, colours: compiled.colours, base: base.source },
  };
}

/**
 * Фильм острова из игры игрока — для окна: байты (чистая основа) и палитра
 * цветов его заливок. Ничего не пишет.
 */
export async function readIslandMap(input, _context, stateDir, tools = {}) {
  const merged = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const base = await merged.islandMapBase({ gameRoot, stateDir });
  const gfx = await fs.readFile(base.gfxFile);
  return {
    source: base.source,
    label: base.label || null,
    gfx: new Uint8Array(gfx),
    palette: readIslandMapPalette(gfx),
  };
}

/*
 * Что окно просит сделать с мини-картой в углу экрана.
 *
 * `radar: "map"` — угол экрана красится в цвета большой карты. Молчание окна
 * — штатная мини-карта.
 *
 * Пары цветов считает окно: у него таблица цвета подложки, и палитра радара
 * проходит ровно через неё (`world-map-base.js`, `radarColours`). Здесь они
 * только проверяются: восемь шестнадцатеричных цифр с каждой стороны, иначе
 * это не цвет.
 */
const RADAR_COLOUR = /^[0-9A-F]{8}=[0-9A-F]{8}$/;

function radarRequest(input) {
  const mode = String(input?.radar || "").trim().toLowerCase();
  if (mode && mode !== "map" && mode !== "game")
    throw new Error("Режим мини-карты в углу экрана задан неизвестным словом.");
  /* `radarLayers: true` — окно положило в сессию слои большой карты для радара
     (`stageRadarOverlay`): зоны и их границы треугольниками. Только при `map`. */
  const layers = mode === "map" && input?.radarLayers === true;
  const raw = Array.isArray(input?.radarColours) ? input.radarColours : [];
  const colours = [];
  for (const item of raw) {
    const pair = String(item || "").toUpperCase();
    if (!RADAR_COLOUR.test(pair))
      throw new Error(`Цвет мини-карты записан не цветом: ${item}`);
    colours.push(pair);
  }
  if (colours.length > 512)
    throw new Error("Слишком много цветов для мини-карты.");
  /* `radarMask: true` — мини-карта без просвета: маски радара в graphics.ytd игрока плотные (`radar-mask.js`). */
  const mask = mode === "map" && input?.radarMask === true;
  /* Наклон «как в машине» (21.11): работает и у штатной мини-карты (`game`), и у перекрашенной. 3D-здания — только у радара «как карта». */
  const tilt = radarTiltRequest(input?.radarTilt);
  const buildings = radarBuildingsRequest(input?.radarBuildings);
  if (buildings && mode !== "map")
    throw new Error("Здания в мини-карте возможны только у радара «как карта».");
  return { mode: mode === "map" ? "map" : "game", colours, layers, mask, tilt, buildings, needed: mode === "map" || Boolean(tilt) };
}

/**
 * Наклон радара из окна: `{ strength }` — целые проценты от радара в машине (40–100). Молчание — наклона нет. Чужое значение — ошибка, а не
 * тихая подгонка: игре уходит ровно то, что человек поставил.
 */
function radarTiltRequest(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Наклон мини-карты задан не набором настроек.");
  const [min, max] = RADAR_TILT_STRENGTH;
  if (!Number.isInteger(raw.strength) || raw.strength < min || raw.strength > max)
    throw new Error(`Сила наклона мини-карты вне пределов ${min}–${max} %.`);
  return { strength: raw.strength };
}

/** Здания в плитках радара: `{ heightScale }` — множитель к районной высоте (ползунок «Высота зданий» 8–80 м при 24 м = 1). */
function radarBuildingsRequest(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Здания мини-карты заданы не набором настроек.");
  const scale = raw.heightScale;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 0.3 || scale > 3.4)
    throw new Error("Высота зданий мини-карты вне пределов.");
  return { heightScale: scale };
}

/** Поля режима машины в `minimap.ymt` игрока — откуда берётся «как в машине» (`radarCarFields`). */
const RADAR_CAR_SOURCE_FIELDS = ["fVehicleTilt", "fVehicleOffset", "fVehicleStaticZoom", "fVehicleMovingZoom", "fVehicleStaticWantedZoom", "fVehicleMovingWantedZoom"];

/**
 * `minimap.ymt` с наклоном «как в машине»: угол, смещение центра и приближение режима машины переносятся на пеший режим. БОЛЬШОЙ радар
 * остаётся как в игре (слово владельца 22.11.2026): `fBigmapTilt` и `fBigmapOffset` явно возвращаются к штатным числам, чтобы свой
 * файл из прежней сборки (где они получали наш угол) тоже вылечился.
 * Числа машины берутся из ШТАТНОГО файла игры (`stock`, x64a.rpf), а НЕ из того, что лежит в update.rpf: там уже наш прошлый файл, и
 * наклон копился бы (50 % → 30°, повтор → 15°, «100 %» оставался бы 8°). Правка ложится на `base` — исправленный свой или штатный файл;
 * при одних и тех же `stock` и силе результат один и тот же байт в байт, сколько бы раз ни нажали «Применить». Одна запись всех полей;
 * каждое после записи читается обратно: не легло — установка не начинается.
 */
export function radarTiltedTunables(base, stock, tilt) {
  if (!base?.length) throw new Error("Настройки мини-карты (minimap.ymt) не прочитались из игры.");
  if (!stock?.length) throw new Error("Штатный minimap.ymt не прочитался из x64a.rpf — не из чего взять режим машины для наклона.");
  const numbers = Object.fromEntries(RADAR_CAR_SOURCE_FIELDS.map((name) => [name, readPsoField(stock, name)[0]]));
  const fields = radarCarFields(numbers, tilt.strength);
  for (const name of RADAR_BIGMAP_STOCK_FIELDS) {
    const value = readPsoField(stock, name)[0];
    if (!Number.isFinite(value)) throw new Error(`В штатном minimap.ymt нет поля ${name}.`);
    fields[name] = value;
  }
  const bytes = Buffer.from(patchPsoField(base, fields).bytes);
  for (const [name, value] of Object.entries(fields))
    if (readPsoField(bytes, name).some((item) => Math.abs(item - value) > 1e-4))
      throw new Error(`Поле ${name} не записалось в minimap.ymt.`);
  return bytes;
}

/** Высоты слоя «кварталы» в плитках радара (штатно 6), шаг слоёв стенки, м, и потолок слоёв (1 — плиты без стенок). */
const RADAR_BLOCK_Z = [5, 9.5];
const RADAR_STACK_SPACING = 2.5;
const RADAR_STACK_LAYERS = 40;

/** Векторная плитка радара, какой её называет игра. */
const RADAR_TILE_NAME = /^minimap_\d{1,2}_\d{1,2}\.ydd$/i;
/** Где игра держит штатные плитки радара. */
const RADAR_STOCK_ARCHIVE = "x64e.rpf";
const RADAR_STOCK_PREFIX = "levels/gta5/minimap.rpf/";

/**
 * Все штатные плитки радара как они лежат в игре: `[{ name, bytes }]`.
 *
 * Контейнер `x64/levels/gta5/minimap.rpf` в update.rpf подменяет штатный
 * архив целиком — так игра подменяет и свои `paths.rpf`/`lodlights.rpf`, и так
 * ставит радар пак ИСКРЫ. Значит, плитка, которой в нашем контейнере нет, из
 * x64e.rpf уже не придёт: на радаре вышла бы дыра. Поэтому неперекрашенные
 * плитки едут в контейнер как есть, байт в байт из игры.
 */
async function readStockRadarTiles({ gameRoot, keysDirectory }) {
  const keys = await keysFromDirectory(keysDirectory);
  const archive = await openRpfFile(path.join(gameRoot, RADAR_STOCK_ARCHIVE), {
    keys,
    nested: true,
  });
  try {
    const tiles = [];
    for (const entry of archive.entries) {
      if (!entry.path.toLowerCase().startsWith(RADAR_STOCK_PREFIX)) continue;
      if (!RADAR_TILE_NAME.test(entry.name)) continue;
      tiles.push({
        name: entry.name.toLowerCase(),
        bytes: Buffer.from(await archive.read(entry.path)),
      });
    }
    return tiles;
  } finally {
    await archive.close?.();
  }
}

/*
 * Настройки мини-карты (`minimap.ymt`) — 22.10, владелец в альфе 48/49: «мини-карта всё равно не очень отображается»,
 * сквозь нашу карту на радаре просвечивал спутник самой игры. Растровый радар до альфы 48 клал в update.rpf свой
 * `x64/data/tune/minimap.ymt` с `bAlwaysDrawBitmap 1` и `fBitmapRequiredZoom 0`: игра рисует картинку радара на любом
 * приближении, а вектор поверх неё. Альфа 48 этот файл писать перестала, но прежний, оставшийся в игре, никто не снимал.
 * Majestic кладёт штатный (`bAlwaysDrawBitmap 0`, `fBitmapRequiredZoom 80`: картинка — только при отдалении).
 *
 * Поля растра сверяются со штатным файлом игрока (x64a.rpf) и, если отличаются, возвращаются к нему правкой на месте;
 * остальное в файле не трогается. Файла в update.rpf нет — в игре и так штатный.
 */
const RADAR_BITMAP_FIELDS = Object.freeze(["bAlwaysDrawBitmap", "fBitmapRequiredZoom"]);

/** `minimap.ymt` из update.rpf (`own`, `null` — его там нет) и штатный из x64a.rpf (`stock`). */
async function readRadarTunables({ gameRoot, keysDirectory }) {
  const keys = await keysFromDirectory(keysDirectory);
  const reader = createGameReader(gameRoot, keys);
  try {
    const own = await reader.read(`update:${WORLD_MAP_RADAR_TUNABLES_ENTRY}`);
    const stock = await reader.read("x64a.rpf:data/tune/minimap.ymt");
    return { own: own ? Buffer.from(own) : null, stock: stock ? Buffer.from(stock) : null };
  } finally {
    await reader.close();
  }
}

/**
 * Поля растра радара в `own` — к значениям штатного `stock`. `null` — править нечего (файла нет или поля штатные);
 * `{ bytes, from, to }` — исправленный файл; без штатного файла или без полей — отказ словами.
 */
export function radarTunablesRepair(own, stock) {
  if (!own?.length) return null;
  if (!stock?.length) throw new Error("Штатный minimap.ymt не прочитался из x64a.rpf — не с чем сверить настройки мини-карты.");
  const from = {};
  const to = {};
  for (const name of RADAR_BITMAP_FIELDS) {
    const [was] = readPsoField(own, name);
    const [want] = readPsoField(stock, name);
    if (was === undefined || want === undefined) throw new Error(`В minimap.ymt нет поля ${name}.`);
    from[name] = was;
    to[name] = want;
  }
  if (RADAR_BITMAP_FIELDS.every((name) => from[name] === to[name])) return null;
  const bytes = Buffer.from(patchPsoField(own, to).bytes);
  for (const name of RADAR_BITMAP_FIELDS)
    if (readPsoField(bytes, name)[0] !== to[name]) throw new Error(`Поле ${name} не вернулось к штатному в minimap.ymt.`);
  return { bytes, from, to };
}

/**
 * Цвета векторных плиток радара из игры игрока — для окна.
 *
 * Ничего не пишет: нативный хост открывает `x64e.rpf` и считает, какими
 * цветами игра рисует угол экрана. Окно пропускает их через свою таблицу
 * цвета и возвращает пары обратно в `applyWorldMapCustomization`.
 */
export async function readRadarTileColours(
  input,
  context,
  stateDir,
  tools = {},
) {
  const merged = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const keys = await archiveKeys(input, stateDir, merged);
  const result = await merged.native(
    "minimap-tile-colours",
    { gameRoot, keys },
    context,
  );
  const report = result?.radar ?? result;
  const colours = Array.isArray(report?.colours) ? report.colours : [];
  if (!colours.length)
    throw new Error("В плитках мини-карты не нашлось ни одного цвета.");
  return {
    source: report?.source || null,
    tiles: Number(report?.tiles) || 0,
    vertices: Number(report?.vertices) || 0,
    colours: colours.map((item) => ({
      rgba: String(item?.rgba || "").toUpperCase(),
      vertices: Number(item?.vertices) || 0,
    })),
  };
}

/**
 * Перекрашенные плитки радара под проект — в ту же папку, что и плитки карты.
 *
 * Плитки не выпотрошены, а ПЕРЕКРАШЕНЫ. Первая версия отдавала игре плитки
 * без моделей — расчёт был на то, что пустой векторный слой уступит место
 * картинке. Игра на таком файле падала при входе в мир: у дравблов оставались
 * габариты и группа шейдеров, но список моделей был нулевым указателем, и
 * радар разыменовывал его на первом же кадре. Теперь нативный хост меняет
 * ровно четыре байта цвета у каждой вершины и после записи сверяет форму
 * файла с исходной (`MinimapRadar.PaintTiles`): число дравблов, моделей,
 * геометрий, вершин и индексов обязано совпасть.
 *
 * Контейнер `x64/levels/gta5/minimap.rpf` собирает тот же помощник, что и
 * архивы DLC. Возвращает одну запись манифеста (`upsert`: в штатном
 * update.rpf этого контейнера нет, игра читает его из x64e.rpf) и сводку.
 */
async function buildRadarFiles(
  request,
  gameRoot,
  packageRoot,
  stateDir,
  context,
  tools,
  session = "",
) {
  if (!request.needed) return null;
  /* Слои большой карты — куски ARO1, которые окно положило в сессию. Со зданиями (геометрия в плитках) зоны на радар не ложатся. */
  const overlays = request.layers && !request.buildings && session ? await sessionOverlays(session, stateDir) : [];
  /* Карта, которую перекраска не тронула (человек не менял цвета вовсе),
     оставила бы угол экрана штатным — и это честнее, чем класть в игру
     побайтно те же плитки под своим именем. Растровому радару пары не
     нужны: под прозрачным вектором — картинка карты. Слои сами по себе —
     причина тронуть радар. */
  if (!request.colours.length && !overlays.length && !request.buildings)
    return request.tilt ? radarTiltOnly(request, gameRoot, packageRoot, stateDir, tools) : null;
  const keys = await archiveKeys({ gameRoot }, stateDir, tools);
  const tilesDirectory = path.join(packageRoot, WORLD_MAP_RADAR_OVERLAY_DIRECTORY);
  await fs.rm(tilesDirectory, { recursive: true, force: true }).catch(() => {});
  const paint = (withLayers) =>
    tools.native(
      "paint-minimap-tiles",
      {
        gameRoot,
        output: tilesDirectory,
        colours: request.colours,
        ...(withLayers ? { overlays } : {}),
        keys,
      },
      context,
    );
  /*
   * Слои хост дописывает в плитки и проверяет перечитыванием, и отказывает, если
   * что-то не сошлось (`MinimapRadar.Overlay.cs`). Отказ слоёв не повод не
   * ставить карту: перекраска радара и сама карта паузы остаются, а причина
   * уходит в сводку — человек увидит, что на мини-карте зоны не легли, и почему.
   */
  let layers = overlays.length ? { ok: false, reason: "", files: overlays.length } : null;
  let painted = null;
  if (overlays.length) {
    try {
      painted = await paint(true);
    } catch (error) {
      layers.reason = String(error?.message || error).slice(0, 600);
      await fs.rm(tilesDirectory, { recursive: true, force: true }).catch(() => {});
      if (!request.colours.length) {
        return {
          files: [],
          summary: {
            mode: "map",
            tiles: 0,
            unchanged: 0,
            overlay: 0,
            repainted: 0,
            colours: 0,
            source: null,
            layers,
          },
        };
      }
    }
  }
  /* 3D-здания (21.11): кварталы встают стопкой слоёв до крыши (высоты по районам, `block-heights.js`), остальное красится палитрой карты —
     одним проходом хоста (`MinimapRadar.StackTiles`). Крыша светлее стен, цвета — от цвета кварталов в палитре карты. */
  if (!painted && request.buildings) painted = await stackRadarBuildings(request, gameRoot, packageRoot, tilesDirectory, keys, context, tools);
  if (!painted) painted = await paint(false);  const report = painted?.radar ?? painted;
  if (layers && report?.overlay)
    layers = {
      /* Хост ответил, а ни один треугольник не лёг: это отказ, а не «зоны нанесены». */
      ok: Number(report.overlay.written) > 0,
      reason: Number(report.overlay.written) > 0 ? "" : "Зоны не легли ни в одну плитку мини-карты.",
      files: overlays.length,
      triangles: Number(report.overlay.written) || 0,
      requested: Number(report.overlay.triangles) || 0,
      tiles: Number(report.overlay.tiles) || 0,
      geometries: Number(report.overlay.geometries) || 0,
      dropped: report.overlay.dropped || null,
    };
  const tiles = Array.isArray(report?.tiles) ? report.tiles : [];
  if (!tiles.length)
    throw new Error(
      "Перекраска мини-карты не тронула ни одной плитки: цвета карты не встречаются в углу экрана.",
    );
  const operations = tiles.map((tile) => {
    const name = String(tile?.file || "");
    if (!RADAR_TILE_NAME.test(name))
      throw new Error(`Недопустимое имя плитки радара: ${name}`);
    return {
      entry: name.toLowerCase(),
      source: path.join(tilesDirectory, name),
      sha256: String(tile?.sha256 || "").toLowerCase(),
      modId: "@astral-world-map",
      action: "import",
    };
  });
  /* Неперекрашенные плитки — в тот же контейнер, как есть: он подменяет
     штатный архив целиком (`readStockRadarTiles`). */
  const inContainer = new Set(operations.map((item) => item.entry));
  const stock = await tools.readStockRadarTiles({ gameRoot, keysDirectory: keys });
  if (!Array.isArray(stock) || !stock.length)
    throw new Error(
      "Штатные плитки мини-карты не прочитались из x64e.rpf — без них радар в игре вышел бы с дырами.",
    );
  let unchanged = 0;
  for (const tile of stock) {
    const name = String(tile?.name || "").toLowerCase();
    if (!RADAR_TILE_NAME.test(name) || inContainer.has(name)) continue;
    const bytes = Buffer.from(tile.bytes);
    await fs.writeFile(path.join(tilesDirectory, name), bytes);
    operations.push({
      entry: name,
      source: path.join(tilesDirectory, name),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      modId: "@astral-world-map",
      action: "import",
    });
    inContainer.add(name);
    unchanged += 1;
  }
  const payload = path.join(packageRoot, "payload");
  await fs.mkdir(payload, { recursive: true });
  const container = path.join(payload, "minimap.rpf");
  await fs.rm(container, { force: true }).catch(() => {});
  await tools.composer.rpfCreate({
    outputArchive: container,
    archiveTarget: WORLD_MAP_RADAR_TILES_ENTRY,
    edition: "Legacy",
    gameRoot,
    operations,
  });
  const containerBytes = await fs.readFile(container);
  /*
   * Те же плитки — ещё и в `scaleform_generic.rpf` update.rpf, поимённо
   * (жалоба 14.10: «на паузе новая карта, на мини-карте штатная»). Этот архив
   * титульное обновление подключает оверлеем (`content.xml`, `overlay`), и его
   * записи перекрывают одноимённые плитки x64e.rpf; так радар ставят векторные
   * паки для GTA5RP (Akio, GUCCI обходит путь `levels/gta5/minimap.rpf` через
   * `images.meta`), и в нём же лежат наши плитки карты паузы, которые у игроков
   * видны. Контейнер остаётся для пути, которым радар ставит пак ИСКРЫ.
   *
   * С 22.10 в оверлей едут ВСЕ плитки контейнера, и неперекрашенные тоже (как
   * есть из игры): растровый радар до альфы 48 клал сюда каждую плитку с
   * прозрачными вершинами, и одноимённая плитка, которой нет в нашем наборе,
   * осталась бы от него прозрачной. Так же и с плитками чужого пака под нами:
   * набор радара — один, целиком наш.
   */
  const overlayFiles = [];
  for (const operation of operations) {
    const name = operation.entry;
    const bytes = await fs.readFile(operation.source);
    overlayFiles.push({
      source: `${WORLD_MAP_RADAR_OVERLAY_DIRECTORY}/${name}`,
      target: "update/update.rpf",
      action: "upsert",
      entry: `${WORLD_MAP_RADAR_OVERLAY_ARCHIVE}/${name}`,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  /* Прежний `minimap.ymt` растрового радара — поля растра обратно к штатным (`radarTunablesRepair`). Не прочитался —
     карта и радар всё равно встают, причина уходит в сводку. */
  let tunables = null;
  const tunablesFiles = [];
  try {
    const read = await tools.readRadarTunables({ gameRoot, keysDirectory: keys });
    const repaired = radarTunablesRepair(read?.own, read?.stock);
    /* Наклон «как в машине» (21.11) — поверх исправленного (или своего, или штатного) файла; запрошенный наклон без файла — отказ. */
    const bytes = request.tilt
      ? radarTiltedTunables(repaired?.bytes ?? read?.own ?? read?.stock, read?.stock, request.tilt)
      : repaired?.bytes || null;
    if (bytes) {
      await fs.writeFile(path.join(payload, "minimap.ymt"), bytes);
      tunablesFiles.push({
        source: WORLD_MAP_RADAR_TUNABLES_SOURCE,
        target: "update/update.rpf",
        action: "upsert",
        entry: WORLD_MAP_RADAR_TUNABLES_ENTRY,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      tunables = {
        restored: Boolean(repaired),
        ...(repaired ? { from: repaired.from, to: repaired.to } : {}),
        ...(request.tilt ? { tilt: request.tilt } : {}),
      };
    }
  } catch (error) {
    if (request.tilt) throw error;
    tunables = { restored: false, reason: String(error?.message || error).slice(0, 300) };
  }
  /* Мини-карта без просвета: маски радара в graphics.ytd игрока — плотные, остальное в файле как было. */
  let mask = null;
  const maskFiles = [];
  if (request.mask) {
    const built = await buildRadarMaskFile({ gameRoot, packageRoot, stateDir }, tools);
    if (built.file) maskFiles.push(built.file);
    mask = built.summary;
  }
  return {
    files: [
      {
        source: WORLD_MAP_RADAR_TILES_SOURCE,
        target: "update/update.rpf",
        action: "upsert",
        entry: WORLD_MAP_RADAR_TILES_ENTRY,
        size: containerBytes.length,
        sha256: createHash("sha256").update(containerBytes).digest("hex"),
      },
      ...overlayFiles,
      ...tunablesFiles,
      ...maskFiles,
    ],
    summary: {
      mode: "map",
      /* Плиток в контейнере — все штатные: перекрашенные и те, которых
         перекраска не коснулась (едут как есть, контейнер подменяет
         штатный minimap.rpf целиком). */
      tiles: operations.length,
      unchanged,
      overlay: overlayFiles.length,
      repainted: Number(report?.repainted) || 0,
      colours: request.colours.length,
      source: report?.source || null,
      /* Слои большой карты на радаре: легли ли и сколько (`null` — не просили). */
      layers,
      /* Прежний `minimap.ymt` с картинкой «всегда»: `null` — его нет или поля штатные; `{ restored, from, to }` —
         поля растра вернулись к штатным; `{ restored: false, reason }` — не прочитался. */
      tunables,
      /* Мини-карта без просвета: `null` — не просили; `{ opaque, masks }` — маски плотные; `{ opaque: false, reason }` —
         запись занята модом каталога или файл не прочитался, маска осталась прежней. */
      mask,
      ...(request.tilt ? { tilt: request.tilt } : {}),
      ...(request.buildings
        ? { buildings: { heightScale: request.buildings.heightScale, blocks: Number(report?.blocks) || 0, addedVertices: Number(report?.addedVertices) || 0 } }
        : {}),
    },
  };
}

/** Радар «только наклон»: один файл настроек, без плиток (установщик пускает `minimap.ymt` без контейнера радара). */
async function radarTiltOnly(request, gameRoot, packageRoot, stateDir, tools) {
  const keys = await archiveKeys({ gameRoot }, stateDir, tools);
  const read = await tools.readRadarTunables({ gameRoot, keysDirectory: keys });
  const repaired = radarTunablesRepair(read?.own, read?.stock);
  const bytes = radarTiltedTunables(repaired?.bytes ?? read?.own ?? read?.stock, read?.stock, request.tilt);
  const payload = path.join(packageRoot, "payload");
  await fs.mkdir(payload, { recursive: true });
  await fs.writeFile(path.join(payload, "minimap.ymt"), bytes);
  return {
    files: [
      {
        source: WORLD_MAP_RADAR_TUNABLES_SOURCE,
        target: "update/update.rpf",
        action: "upsert",
        entry: WORLD_MAP_RADAR_TUNABLES_ENTRY,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
    summary: {
      mode: request.mode,
      tiles: 0,
      unchanged: 0,
      overlay: 0,
      repainted: 0,
      colours: 0,
      source: null,
      layers: null,
      tunables: { restored: Boolean(repaired), tilt: request.tilt },
      mask: null,
      tilt: request.tilt,
    },
  };
}

/**
 * Плитки радара со зданиями (21.11): палитру игры хост отдаёт командой `minimap-tile-colours`, цвет роли «кварталы» берётся из пары окна
 * (нет пары — остаётся прежним), остальные пары красят вершины в том же проходе. Ответ — как у `paint-minimap-tiles`.
 */
async function stackRadarBuildings(request, gameRoot, packageRoot, tilesDirectory, keys, context, tools) {
  const paletteReport = await tools.native("minimap-tile-colours", { gameRoot, keys }, context);
  const palette = (paletteReport?.radar ?? paletteReport)?.colours;
  if (!Array.isArray(palette) || !palette.length)
    throw new Error("В плитках мини-карты не нашлось ни одного цвета.");
  const mapped = new Map(request.colours.map((pair) => pair.split("=")));
  const blockPairs = [];
  for (const item of palette) {
    const from = String(item?.rgba || "").toUpperCase();
    if (!/^[0-9A-F]{8}$/.test(from)) continue;
    const [red, green, blue] = [0, 2, 4].map((at) => parseInt(from.slice(at, at + 2), 16));
    if (classifyRadarColour(red, green, blue, 0).role === "blocks") blockPairs.push(`${from}=${mapped.get(from) || from}`);
  }
  if (!blockPairs.length) throw new Error("В плитках мини-карты не нашлось цвета кварталов для зданий.");
  const gridFile = path.join(packageRoot, "block-height-grid.json");
  const grid = blockHeightGrid();
  await fs.writeFile(gridFile, JSON.stringify({ ...grid, values: [...grid.values] }));
  try {
    return await tools.native(
      "stack-minimap-tiles",
      {
        gameRoot,
        output: tilesDirectory,
        keys,
        heightGrid: gridFile,
        heightScale: request.buildings.heightScale,
        zFrom: RADAR_BLOCK_Z[0],
        zTo: RADAR_BLOCK_Z[1],
        spacing: RADAR_STACK_SPACING,
        layersMax: RADAR_STACK_LAYERS,
        blocks: blockPairs,
        paints: request.colours,
      },
      context,
    );
  } finally {
    await fs.rm(gridFile, { force: true }).catch(() => {});
  }
}

/**
 * Пакет карты для движка: плитки, собранные нативным хостом, становятся
 * записями `replace` внутри update.rpf, файл ступеней приближения — записью
 * `upsert`, фильм карты паузы — записью `replace`, плитки и настройки радара
 * — записями `upsert`. Право на запись в корень игры даёт строгая форма
 * манифеста (`isLocalWorldMapManifest`), поэтому она собирается здесь
 * буквально, поле за полем.
 */
export function buildWorldMapPackage(
  built,
  packageRoot,
  zoomFile = null,
  pauseMapFile = null,
  radarFiles = [],
  { name = "Custom world map", pauseBlurFile = null, islandFile = null } = {},
) {
  const report = built?.map?.tiles ?? built?.tiles ?? [];
  if (!Array.isArray(report) || !report.length)
    throw new Error("Сборка карты не вернула ни одной плитки.");
  const files = report.map((tile) => {
    const archive = String(tile?.archive || "")
      .split("\\")
      .join("/");
    if (archive.toLowerCase() !== "update/update.rpf")
      throw new Error(
        `Плитки карты лежат в ${archive || "неизвестном архиве"}, а слой Astral пишет только в update/update.rpf. Уберите чужую большую карту или слой mods и прочитайте карту из игры заново.`,
      );
    const entry = String(tile?.entry || "")
      .split("\\")
      .join("/");
    const match = TILE_ENTRY.exec(entry);
    if (!match)
      throw new Error(
        `Плитка ${tile?.file || "?"} лежит не там, где её ждёт игра: ${entry}`,
      );
    const name = match[1].toLowerCase();
    if (String(tile?.file || "").toLowerCase() !== name)
      throw new Error(
        `Имя плитки ${tile?.file} не совпадает с записью ${entry}`,
      );
    const size = Number(tile?.bytes);
    if (!Number.isInteger(size) || size <= 0)
      throw new Error(`У плитки ${name} нет размера.`);
    const sha256 = String(tile?.sha256 || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new Error(`У плитки ${name} нет контрольной суммы.`);
    return {
      source: `payload/${name}`,
      target: "update/update.rpf",
      action: "replace",
      entry: `x64/data/cdimages/scaleform_generic.rpf/${name}`,
      size,
      sha256,
    };
  });
  const tileCount = files.length;
  if (zoomFile) files.push({ ...zoomFile });
  if (pauseMapFile) files.push({ ...pauseMapFile });
  if (pauseBlurFile) files.push({ ...pauseBlurFile });
  if (islandFile) files.push({ ...islandFile });
  const radar = Array.isArray(radarFiles) ? radarFiles : [];
  for (const file of radar) files.push({ ...file });
  const digest = worldMapSourceDigest(files);
  const suffix = digest.slice(0, 12);
  return {
    packageRoot,
    digest,
    manifest: {
      id: `local-legacy-world-map-${suffix}`,
      version: `1.0.0-${suffix}`,
      name: `${name}: ${suffix}`,
      editions: ["Legacy"],
      scope: "game-root",
      adapter: "rpf-entry",
      requiresLoader: false,
      gameplayChanges: false,
      capabilities: ["rpf-container-entry-v1", "direct-update-entries-v1"],
      slots: ["large-map"],
      worldMap: {
        /* Шестая опись — с островом Кайо-Перико; без него остаётся пятая,
           как её писали до 19.10. */
        schemaVersion: islandFile ? 6 : 5,
        sourceDigest: `sha256:${digest}`,
        tileCount,
        zoomData: Boolean(zoomFile),
        pauseMap: Boolean(pauseMapFile),
        /* Опись говорит о контейнере плиток радара; настройки наклона без плиток — не радар «как карта». */
        radar: radar.some((file) => file.entry === WORLD_MAP_RADAR_TILES_ENTRY),
        pauseBlur: Boolean(pauseBlurFile),
        ...(islandFile ? { island: true } : null),
      },
      files,
    },
  };
}

/*
 * Запись переигрывания карты (`engineReplay`, шаг 3 фазы 7, за флагом `ASTRAL_ENGINE_INSTALL=world-map-customizer`):
 * пакет, дайджест и список файлов из манифеста (путь, отпечаток, размер, запись в игре). Файлы лежат в
 * папке пакета сессии: запись хранит её путь, и проверка видит, что файлы на месте.
 */
export function worldMapReplayRecord(built) {
  return {
    module: "world-map-customizer",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: `sha256:${built.digest}`,
    order: {
      packageRoot: path.resolve(String(built.packageRoot)),
      files: built.manifest.files.map((file) => ({
        source: file.source,
        entry: file.entry,
        size: file.size,
        sha256: file.sha256,
      })),
    },
  };
}

/*
 * Пакет карты для переигрывания: файлы на месте, их SHA-256 и размеры — те, что в записи, а дайджест,
 * пересобранный из записей, даёт тот же дайджест. Иначе — отказ, который называет работу, до записи в игру.
 */
export async function worldMapReplayPackage(replay) {
  const workName = String(replay?.workId || "карта");
  const digest = String(replay?.sourceDigest || "");
  const packageRoot = String(replay?.order?.packageRoot || "");
  const listed = Array.isArray(replay?.order?.files) ? replay.order.files : [];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !path.isAbsolute(packageRoot) || !listed.length)
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — постройте карту заново в мастерской.`);
  for (const item of listed) {
    const file = path.join(packageRoot, String(item?.source || ""));
    const stat = item?.source ? await fs.stat(file).catch(() => null) : null;
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — постройте карту заново в мастерской.`);
    if ((await sha256File(file)) !== String(item.sha256 || "") || stat.size !== item.size)
      throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — постройте карту заново в мастерской.`);
  }
  if (`sha256:${worldMapSourceDigest(listed)}` !== digest)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — постройте карту заново в мастерской.`);
  return { packageRoot, files: listed };
}

/*
 * Копия пакета карты в постоянном хранилище (правило фазы 7): запись переигрывания держит только то, что
 * лежит в `stateDir`. Папка сессии (staging) уходит, поэтому файлы копируются до записи точки.
 */
export async function persistWorldMapPackage(built, stateDir) {
  const target = path.join(path.resolve(String(stateDir || "")), "world-map", "packages", String(built.digest).slice(0, 16));
  for (const file of built.manifest.files) {
    const from = path.join(built.packageRoot, file.source);
    const to = path.join(target, file.source);
    const current = await fs.stat(to).catch(() => null);
    if (current?.isFile() && current.size === file.size && (await sha256File(to)) === file.sha256) continue;
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rm(to, { force: true });
    await fs.copyFile(from, to);
    if ((await sha256File(to)) !== file.sha256)
      throw new Error("Файл карты изменился при копировании в хранилище — установка отменена.");
  }
  return target;
}

/*
 * Счётчик ссылок: копии карт, на которые ссылается установленная работа, не трогаем; прочие уходят.
 * Состояние не прочиталось — ничего не удаляем.
 */
export async function sweepWorldMapPackages(stateDir) {
  const root = path.join(path.resolve(String(stateDir || "")), "world-map", "packages");
  const profile = await inspectProfile({ stateDir }).catch(() => null);
  if (!profile) return;
  const kept = new Set();
  for (const target of Object.values(profile.targets || {}))
    for (const item of target?.installed || []) {
      const replay = item?.engineReplay;
      if (replay?.module === "world-map-customizer")
        kept.add(String(replay.sourceDigest || "").slice("sha256:".length, "sha256:".length + 16));
    }
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries)
    if (entry.isDirectory() && !kept.has(entry.name))
      await fs.rm(path.join(root, entry.name), { recursive: true, force: true }).catch(() => {});
}

const replacementIds = (plan) =>
  [...new Set((plan?.conflicts || []).map((item) => item.modId))].sort();

/*
 * Профиль установки — тот же, что у остального приложения: игра из
 * обнаружения по её папке. Свой ключ по пути завёл бы второй профиль на ту
 * же игру с собственной резервной копией update.rpf, и два профиля спорили бы
 * за один живой архив.
 */
async function resolveTarget(gameRoot, input, tools) {
  const games = await tools.discoverGames();
  const game = (Array.isArray(games) ? games : []).find(
    (item) =>
      path.resolve(String(item?.path || "")).toLowerCase() ===
      gameRoot.toLowerCase(),
  );
  if (!game) throw new Error("Папка GTA V Legacy не подтверждена Astral.");
  if (String(game.edition || "Legacy").toLowerCase() !== "legacy")
    throw new Error(
      "Большая карта Majestic / GTA5RP поддерживает только GTA V Legacy.",
    );
  const requested = String(input?.targetId || "").trim();
  if (requested && requested !== String(game.id || ""))
    throw new Error("Профиль установки не совпадает с выбранной папкой GTA V.");
  return game;
}

function engineOptions(built, gameRoot, game, stateDir, tools) {
  const { rpfProbe } = tools.composer;
  return {
    manifest: built.manifest,
    packageRoot: built.packageRoot,
    gameRoot,
    targetId: String(game.id || "default"),
    edition: "Legacy",
    stateDir,
    ...(typeof rpfProbe === "function" ? { rpfProbe } : {}),
  };
}

/**
 * План установки: что именно поменяется в игре.
 * Патч собирается и проверяется движком до того, как человек нажмёт «Применить».
 */
export async function planWorldMapCustomization(
  input,
  context,
  stateDir,
  tools = {},
) {
  const merged = { ...defaultTools(), ...tools };
  const prepared = await buildPatch(
    input,
    context,
    stateDir,
    merged.native,
    merged,
  );
  const game = await resolveTarget(prepared.gameRoot, input, merged);
  const zoom = await buildZoomFile(
    zoomRequest(input),
    prepared.gameRoot,
    prepared.patch,
    merged,
  );
  const pause = await buildPauseMapFile(
    pauseMapRequest(input),
    prepared.gameRoot,
    prepared.patch,
    stateDir,
    merged,
  );
  const radar = await buildRadarFiles(
    radarRequest(input),
    prepared.gameRoot,
    prepared.patch,
    stateDir,
    context,
    merged,
    prepared.session,
  );
  const blur = await buildPauseBlur(input, prepared.gameRoot, prepared.patch, stateDir, merged);
  const island = await buildIslandFile(
    islandRequest(input),
    prepared.gameRoot,
    prepared.patch,
    stateDir,
    merged,
  );
  const built = buildWorldMapPackage(
    prepared.built,
    prepared.patch,
    zoom?.file,
    pause?.file,
    radar?.files,
    { pauseBlurFile: blur?.file || null, islandFile: island?.file || null },
  );
  const plan = await merged.engine.plan(
    engineOptions(built, prepared.gameRoot, game, stateDir, merged),
  );
  return {
    ...prepared,
    plan,
    modId: built.manifest.id,
    targetId: String(game.id || "default"),
    digest: `sha256:${built.digest}`,
    zoom: zoom?.summary || null,
    pauseMap: pause?.summary || null,
    radar: radar?.summary || null,
    pauseBlur: blur?.summary || null,
    island: island?.summary || null,
    replaceModIds: replacementIds(plan),
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
    archive: "update/update.rpf",
    restartRequired: true,
  };
}

/**
 * Записывает карту в игру транзакцией движка: резервная копия update.rpf и
 * контрольная точка — те же, что у любого мода слоя Astral.
 */
export async function applyWorldMapCustomization(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, onProgress = null, ...tools } = {},
) {
  const merged = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  await assertRuntimeSafety?.(gameRoot);
  const game = await resolveTarget(gameRoot, input, merged);
  const prepared = await buildPatch(
    input,
    context,
    stateDir,
    merged.native,
    merged,
  );
  const zoom = await buildZoomFile(
    zoomRequest(input),
    gameRoot,
    prepared.patch,
    merged,
  );
  const pause = await buildPauseMapFile(
    pauseMapRequest(input),
    gameRoot,
    prepared.patch,
    stateDir,
    merged,
  );
  const radar = await buildRadarFiles(
    radarRequest(input),
    gameRoot,
    prepared.patch,
    stateDir,
    context,
    merged,
    prepared.session,
  );
  const blur = await buildPauseBlur(input, gameRoot, prepared.patch, stateDir, merged);
  const island = await buildIslandFile(islandRequest(input), gameRoot, prepared.patch, stateDir, merged);
  const built = buildWorldMapPackage(
    prepared.built,
    prepared.patch,
    zoom?.file,
    pause?.file,
    radar?.files,
    { pauseBlurFile: blur?.file || null, islandFile: island?.file || null },
  );
  /* Флаг `ASTRAL_ENGINE_INSTALL=world-map-customizer`: запись переигрывания держит копию в хранилище, не в staging. */
  if (engineInstallEnabled("world-map-customizer")) built.packageRoot = await persistWorldMapPackage(built, stateDir);
  const options = engineOptions(built, gameRoot, game, stateDir, merged);
  const plan = await merged.engine.plan(options);
  /* Флаг `ASTRAL_ENGINE_INSTALL=world-map-customizer`: подмену `update.rpf` ведёт движок, точка — с `replay.json`. */
  const engineInstall = engineInstallEnabled("world-map-customizer")
    ? {
        install: merged.installPrebuilt ?? installRpfPrebuilt,
        edition: "Legacy",
        gameRoot,
        pointsRoot: nativeRestorePointsRoot(),
        replay: worldMapReplayRecord(built),
      }
    : null;
  await merged.engine.install({
    ...options,
    replaceModIds: replacementIds(plan),
    rpfComposer: merged.composer.rpfComposer,
    contentXmlProvider: merged.composer.contentXmlProvider,
    dlcListProvider: merged.composer.dlcListProvider,
    assertRuntimeSafety:
      typeof assertRuntimeSafety === "function"
        ? () => assertRuntimeSafety(gameRoot)
        : null,
    /* Пересборка update.rpf идёт десятки секунд: без вестей от движка окно
       выглядит зависшим, и человек закрывает его посреди записи. */
    ...(typeof onProgress === "function" ? { onProgress } : {}),
    ...(engineInstall ? { engineInstall } : {}),
  });
  if (engineInstallEnabled("world-map-customizer")) await sweepWorldMapPackages(stateDir).catch(() => {});
  return {
    modId: built.manifest.id,
    targetId: options.targetId,
    digest: `sha256:${built.digest}`,
    patch: prepared.patch,
    tiles: prepared.built?.map?.tiles ?? prepared.built?.tiles ?? [],
    zoom: zoom?.summary || null,
    pauseMap: pause?.summary || null,
    radar: radar?.summary || null,
    pauseBlur: blur?.summary || null,
    island: island?.summary || null,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
    archive: "update/update.rpf",
    restartRequired: true,
    status: "active",
    installedAt: new Date().toISOString(),
  };
}

/** Снимает карту: слой мода уходит, предыдущая карта возвращается. */
export async function removeWorldMapCustomization(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, onProgress = null, ...tools } = {},
) {
  const merged = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const modId = String(input?.modId || "").trim();
  if (!WORLD_MAP_MOD_ID.test(modId))
    throw new Error("Некорректный идентификатор установленной карты.");
  await assertRuntimeSafety?.(gameRoot);
  const game = await resolveTarget(gameRoot, input, merged);
  await merged.engine.uninstall({
    modId,
    targetId: String(game.id || "default"),
    stateDir,
    rpfComposer: merged.composer.rpfComposer,
    contentXmlProvider: merged.composer.contentXmlProvider,
    dlcListProvider: merged.composer.dlcListProvider,
    assertRuntimeSafety:
      typeof assertRuntimeSafety === "function"
        ? () => assertRuntimeSafety(gameRoot)
        : null,
    ...(typeof onProgress === "function" ? { onProgress } : {}),
  });
  return {
    modId,
    targetId: String(game.id || "default"),
    status: "rolled-back",
    restartRequired: true,
    removedAt: new Date().toISOString(),
  };
}

/**
 * Плитки большой карты из установки игрока.
 *
 * Редактор рисует поверх той карты, которая реально стоит у человека: если у
 * него уже лежит чужой графический мод, подложкой будет он, а не ванильная
 * карта Rockstar. Ничего никуда не отправляется — файлы остаются на его машине.
 */
/*
 * Каталог ключей для чтения архива: явно переданный побеждает, иначе берётся
 * у той же поставки ArchiveFix, что и запись. Без ключей зашифрованная запись
 * на свежих сборках не читается вовсе.
 */
async function archiveKeys(input, stateDir, tools) {
  const { archiveSupport } = { ...defaultTools(), ...tools };
  return archiveKeysDirectory({
    keys: input?.keys,
    stateDir,
    provision: archiveSupport,
  });
}

/*
 * Отпечаток архивов, из которых прочитаны плитки.
 *
 * Кэш ключевался одной папкой игры и не сбрасывался никогда. Пока карту только
 * читали, это было незаметно; с записью в игру — нет: человек применяет свою
 * карту, открывает редактор снова и видит подложку, какой она была ДО
 * применения. Подложка «из моей игры» переставала быть правдой ровно после
 * того, как ею воспользовались.
 *
 * Размер и время правки архива дешевле хеша по двум гигабайтам и меняются при
 * любой записи — и нашей, и чужого установщика. Архивы берутся те, из которых
 * манифест читал: у игрока с mods-папкой или чужой большой картой это не
 * всегда `update/update.rpf`.
 */
async function archiveFingerprint(gameRoot, manifest) {
  /*
   * Помнить только архив, из которого прочитали, — мало. Нативный хост ищет
   * плитки в фиксированном порядке (`ArchiveSearchOrder`): сначала
   * `x64a.rpf`, потом `update/update.rpf`, потом остальные `x64*.rpf`, — и
   * берёт первое попадание. Мод, положенный в архив РАНЬШЕ по этому порядку,
   * перехватит плитки, а прежний файл при этом останется нетронутым, и кэш
   * ничего не заметит. Поэтому оба перехватчика лежат в отпечатке всегда,
   * даже когда читали не из них; отсутствующий архив честно отмечается «?».
   */
  const names = new Set(["x64a.rpf", "update/update.rpf"]);
  for (const tile of manifest?.tiles || []) {
    const name = String(tile?.archive || "").trim();
    if (name) names.add(name);
  }
  /*
   * Слой mods — тот же перехватчик, только сверху: игра с загрузчиком OpenIV
   * читает `mods/<архив>`, когда он есть. Появление и исчезновение этой копии
   * меняют карту, не трогая ванильный файл, поэтому в отпечатке лежат обе
   * стороны каждой пары.
   */
  for (const name of [...names]) {
    names.add(
      name.startsWith("mods/") ? name.slice("mods/".length) : `mods/${name}`,
    );
  }
  /*
   * Загрузчик — тоже вход этого решения, и он меняется отдельно от архивов.
   * Копия в `mods` может лежать давно, а `dinput8.dll` появиться сегодня: с
   * этого момента игра читает другой файл, хотя ни один архив не тронут.
   * Само правило живёт в `game-archive-layer.js`; здесь мы не повторяем его
   * решение, а наблюдаем те же входы — отпечатку нужно видеть изменение, а не
   * закешированный ответ. Имена берутся оттуда же: пары `dinput8.dll` +
   * `OpenIV.asi` мало, свой слой Astral ставит через `RageOpenV.asi`, а
   * Enhanced грузится через `xinput1_4.dll`.
   */
  for (const name of [...ASI_LOADERS, ...MODS_PLUGINS]) names.add(name);
  const root = path.resolve(gameRoot);
  const parts = [];
  for (const name of [...names].sort()) {
    /* Имя приходит из манифеста нативного хоста, но выйти за папку игры не
       должно и оно: путь наружу означает, что сверять нечего. */
    const full = path.resolve(root, name);
    if (!full.startsWith(root)) {
      parts.push(`${name}:!`);
      continue;
    }
    const stat = await fs.stat(full).catch(() => null);
    parts.push(
      stat ? `${name}:${stat.size}:${Math.round(stat.mtimeMs)}` : `${name}:?`,
    );
  }
  return parts.join("|");
}

export async function readWorldMapTiles(input, context, stateDir, tools = {}) {
  const merged = { ...defaultTools(), ...tools };
  const { native } = merged;
  const gameRoot = requireGameRoot(input);
  /*
   * Окно просит и сводку того, что лежит в игре сейчас (`live: true`, 17.10):
   * редактор показывает штатную карту, а лагать может чужой атлас в архиве.
   * Сводка — по заголовкам, без записи; не прочиталась — её просто нет.
   */
  const live = input?.live === true
    ? await archiveKeys(input, stateDir, merged)
        .then((keysDirectory) => merged.describeLive({ gameRoot, keysDirectory }))
        .catch(() => null)
    : undefined;
  const withLive = (result) => (live === undefined ? result : { ...result, live });
  /*
   * Штатная карта Rockstar — прежде всего. «Карта из игры» в редакторе
   * обязана быть картой Rockstar, а не тем, что лежит в архиве после наших
   * же установок: основа движка тоже бывает с нашей картой внутри.
   */
  const stock = await merged.stock
    .resolve({ gameRoot, stateDir, context }, merged)
    .catch(() => null);
  if (stock) {
    const tiles = [];
    for (const tile of stock.tiles.slice(0, MAX_TILES)) {
      const bytes = await fs.readFile(tile.png).catch(() => null);
      if (!bytes) continue;
      tiles.push({
        name: tile.name,
        file: tile.file,
        entry: tile.entry,
        archive: tile.archive,
        width: tile.width,
        height: tile.height,
        levels: tile.levels,
        format: tile.format,
        png: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      });
    }
    if (tiles.length)
      return withLive({
        source: "game",
        stock: { source: stock.source, rememberedAt: stock.rememberedAt },
        tiles,
      });
  }
  const directory = path.join(cacheRoot(stateDir), cacheKey(gameRoot));
  const manifestPath = path.join(directory, "tiles.json");
  /* Карта человека, а не наша: после установки живой update.rpf несёт уже
     нашу карту, и «Как в игре» возвращало бы её же (`tileBaseArchive`). */
  const base = await tileBaseArchive({ gameRoot, stateDir }, merged);
  const baseStamp = base ? `${base.path}:${base.size}:${base.mtimeMs}` : "live";

  let manifest = input?.refresh
    ? null
    : await fs
        .readFile(manifestPath, "utf8")
        .then(JSON.parse)
        .catch(() => null);

  /* Архив изменился с прошлого чтения — кэш описывает уже не ту игру.
     Манифест без отпечатка написан до этой проверки: он пересобирается тоже,
     потому что о его свежести ничего не известно. Основа — отдельный вход:
     первая же установка карты переводит чтение с живого архива на копию до
     неё, и кэш обязан это заметить. */
  if (
    manifest &&
    (manifest.archives !== (await archiveFingerprint(gameRoot, manifest)) ||
      manifest.base !== baseStamp)
  )
    manifest = null;

  if (!manifest) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(directory, { recursive: true });
    /* Ключи те же, что у записи: без них плитки карты не расшифровать, и
       подложка «из моей игры» не читалась бы ни в карте, ни в HUD. */
    const keys = await archiveKeys(input, stateDir, tools);
    const result = await native(
      "extract-map-tiles",
      { gameRoot, output: directory, keys, baseArchive: base?.path || null },
      context,
    );
    manifest = result?.map ?? result;
    manifest.archives = await archiveFingerprint(gameRoot, manifest);
    manifest.base = baseStamp;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const tiles = [];
  for (const tile of (manifest.tiles || []).slice(0, MAX_TILES)) {
    const file = path.join(directory, path.basename(String(tile.png || "")));
    const bytes = await fs.readFile(file).catch(() => null);
    if (!bytes) continue;
    tiles.push({
      name: String(tile.texture || ""),
      file: String(tile.file || ""),
      entry: String(tile.entry || ""),
      archive: String(tile.archive || ""),
      width: Number(tile.width) || 0,
      height: Number(tile.height) || 0,
      /*
       * Формат и число мип-уровней нужны экспорту: новая плитка пишется
       * такой же, какой была старая. Игра хранит большую карту в DXT5, и
       * заменить её на BC1 значит потерять прозрачность.
       */
      levels: Number(tile.levels) || 1,
      format: String(tile.format || ""),
      // Копия в отдельный ArrayBuffer: срез общего пула Buffer утащил бы по
      // IPC чужую память.
      png: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
    });
  }
  if (!tiles.length) throw new Error("В архивах игры не нашлось плиток карты.");
  /* Штатной карты не нашлось: это карта из архива, в котором Astral уже
     писал, и окно обязано сказать об этом, а не выдать её за карту Rockstar. */
  return withLive({ source: "game", stock: null, tiles });
}

/**
 * Что показывает игра и к чему вернётся после снятия карты — против
 * штатной карты Rockstar. Ничего не пишет.
 */
export async function stockWorldMapStatus(input, context, stateDir, tools = {}) {
  const merged = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  return merged.stock.status({ gameRoot, stateDir, context }, merged);
}

/**
 * Возвращает игре штатную карту Rockstar, когда снятием своей её не
 * вернуть: основа движка сама несёт нашу прошлую карту.
 *
 * Штатные плитки, фильм карты паузы и ступени приближения уезжают обычным
 * пакетом карты — той же транзакцией движка, с резервной копией и точкой
 * отката, и занимают тот же слот: своя карта, если стояла, снимается с
 * ними. Плитки и фильм — `replace` (в архиве они есть всегда), ступени —
 * `upsert` штатным файлом из common.rpf: убрать запись пакет не может, а
 * штатное содержимое поверх нашего — то же, что и её отсутствие.
 */
export async function restoreStockWorldMap(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, onProgress = null, ...tools } = {},
) {
  const merged = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  await assertRuntimeSafety?.(gameRoot);
  const game = await resolveTarget(gameRoot, input, merged);
  const status = await merged.stock.status(
    { gameRoot, stateDir, context },
    merged,
  );
  if (!status?.stock)
    throw new Error(
      "Штатной карты Rockstar в копиях Astral не нашлось. Проверьте файлы игры в Steam и откройте карту заново.",
    );
  if (status.live?.clean)
    return {
      status: "already",
      stock: true,
      source: status.stock.source,
      restartRequired: false,
    };
  const stock = await merged.stock.resolve({ gameRoot, stateDir, context }, merged);
  const packageRoot = path.join(stagingRoot(stateDir), `stock-${randomUUID()}`);
  const payload = path.join(packageRoot, "payload");
  await fs.mkdir(payload, { recursive: true });
  const report = [];
  for (const tile of stock.tiles) {
    const target = path.join(payload, tile.file);
    await fs.copyFile(tile.ytd, target);
    report.push({
      file: tile.file,
      archive: "update/update.rpf",
      entry: tile.entry,
      bytes: tile.bytes,
      sha256: tile.sha256,
    });
  }
  /* Фильм — только если он отличается хоть где-то: в живом архиве или в
     основе, к которой игра вернулась бы после снятия. */
  const movieDiffers = Boolean(status.live?.movie || status.base?.movie);
  let pauseMapFile = null;
  if (movieDiffers) {
    const bytes = await fs.readFile(stock.movie.file);
    await fs.writeFile(path.join(payload, "minimap_main_map.gfx"), bytes);
    pauseMapFile = {
      source: WORLD_MAP_PAUSE_SOURCE,
      target: "update/update.rpf",
      action: "replace",
      entry: WORLD_MAP_PAUSE_ENTRY,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  const zoomDiffers = Boolean(status.live?.zoom || status.base?.zoom);
  let zoomFile = null;
  if (zoomDiffers) {
    const scratch = path.join(packageRoot, "zoom-base.meta");
    const xml = await merged.readGameText({
      gameRoot,
      ...ZOOM_BASE,
      output: scratch,
    });
    await fs.rm(scratch, { force: true }).catch(() => {});
    const bytes = Buffer.from(String(xml), "utf8");
    await fs.writeFile(path.join(payload, "mapzoomdata.meta"), bytes);
    zoomFile = {
      source: WORLD_MAP_ZOOM_SOURCE,
      target: "update/update.rpf",
      action: "upsert",
      entry: WORLD_MAP_ZOOM_ENTRY,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  const built = buildWorldMapPackage(
    { map: { tiles: report } },
    packageRoot,
    zoomFile,
    pauseMapFile,
    [],
    { name: "Stock world map (restored)" },
  );
  const options = engineOptions(built, gameRoot, game, stateDir, merged);
  const plan = await merged.engine.plan(options);
  await merged.engine.install({
    ...options,
    replaceModIds: replacementIds(plan),
    rpfComposer: merged.composer.rpfComposer,
    contentXmlProvider: merged.composer.contentXmlProvider,
    dlcListProvider: merged.composer.dlcListProvider,
    assertRuntimeSafety:
      typeof assertRuntimeSafety === "function"
        ? () => assertRuntimeSafety(gameRoot)
        : null,
    ...(typeof onProgress === "function" ? { onProgress } : {}),
  });
  return {
    modId: built.manifest.id,
    targetId: options.targetId,
    digest: `sha256:${built.digest}`,
    stock: true,
    status: "active",
    source: status.stock.source,
    restored: {
      tiles: report.length,
      movie: movieDiffers,
      zoom: zoomDiffers,
    },
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
    archive: "update/update.rpf",
    restartRequired: true,
    installedAt: new Date().toISOString(),
  };
}
