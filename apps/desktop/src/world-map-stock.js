/*
 * Штатная большая карта — из игры самого игрока.
 *
 * «Как в игре» и «Сбросить карту» обещают карту Rockstar. Отдавать за неё
 * основу движка (копию update.rpf, поверх которой он собирает слои) нельзя:
 * основа снимается с живого архива при каждом перебазировании, а живой архив
 * к тому времени уже мог нести нашу же прошлую карту. 22.09 у владельца так
 * и вышло: основа несла плитки 2048² с двенадцатью мипами, свой файл ступеней
 * приближения и перекрашенный фильм карты паузы — и «сброс» возвращал игре
 * ровно эту, синюю, карту. Файлов Rockstar в поставке нет, значит штатные
 * плитки надо находить в том, что есть у человека, — и запоминать.
 *
 * Откуда брать, решает порядок доверия:
 *
 *   1. основа движка — если она чистая, это ровно то, к чему игра вернётся
 *      после снятия карты;
 *   2. остальные копии архива в памяти движка — снятая при первой подготовке
 *      слоя (`bases/<цель>/update-update.rpf.original.rpf`) и снятые при
 *      перебазированиях (`bases/<цель>/update-rebases/*.rpf`) — от новой к
 *      старой: каждая — байт в байт архив игрока на какой-то момент, и чем
 *      новее чистая копия, тем ближе она к нынешней сборке игры;
 *   3. живой `update/update.rpf` — когда Astral ещё ничего не писал.
 *
 * Кандидат принимается только целиком штатным: двенадцать плиток штатной
 * формы (карта паузы 1024² DXT5, радар 512² DXT1, по одному мипу — свои мы
 * пишем крупнее или с цепочкой мипов), без СВОЕГО файла ступеней приближения
 * в update.rpf (у Rockstar он лежит в common.rpf; в update.rpf его кладём
 * только мы, и штатный текст поверх — то же, что его отсутствие) и со
 * штатным фильмом карты паузы (море штатного цвета, контуры на месте). Найденное копируется в память приложения вместе с картинками
 * плиток: копии архива движок со временем чистит, а штатная карта нужна
 * всегда.
 *
 * Модуль ничего не пишет в игру. Кто и как возвращает штатную карту в архив,
 * решает `world-map-customizer.js` (`restoreStockWorldMap`).
 */

import { ensureStoredFile, PACKED_SUFFIX, storedFileStamp } from "@modovik/install-engine/chunk-store.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  getAstralLayerStatus,
  WORLD_MAP_PAUSE_ENTRY,
} from "@modovik/install-engine";
import { readStateShared } from "@modovik/install-engine/engine-state.js";
import { PAUSE_MAP_GAME_SEA } from "@modovik/vector-map";
import { callNativeEngine } from "./native-engine.js";
import { resolvePauseMapModel } from "./pause-map-gfx-compiler.js";
import { extractRpfEntries, searchRpfArchive } from "./rpf-composer.js";
import {
  archiveKeysDirectory,
  provisionArchiveSupport,
} from "./loader-provisioner.js";

/** Папка памяти внутри stateDir — рядом с `pause-map-bases` и `minimap-bases`. */
export const STOCK_MEMORY = "world-map-bases";

const UPDATE_ARCHIVE = "update/update.rpf";
const TILE_DIRECTORY = "x64/data/cdimages/scaleform_generic.rpf";

/** Ступени приближения: у Rockstar их в update.rpf нет — только у нас. */
export const STOCK_ZOOM_ENTRY = "common/data/ui/mapzoomdata.meta";

/** Двенадцать плиток атласа, какими их называет игра. */
export const STOCK_TILE_NAMES = Object.freeze(
  ["", "sea_"].flatMap((family) =>
    [0, 1, 2].flatMap((row) =>
      [0, 1].map((column) => `minimap_${family}${row}_${column}`),
    ),
  ),
);

/*
 * Штатная форма плитки. Свои плитки Astral пишет либо крупнее (карта паузы
 * ×2…×4, радар «как большая карта»), либо с цепочкой мипов; штатные — ровно
 * такие и с одним уровнем.
 */
const STOCK_SHAPE = Object.freeze({
  sea: Object.freeze({ side: 1024, format: "D3DFMT_DXT5" }),
  land: Object.freeze({ side: 512, format: "D3DFMT_DXT1" }),
});

const familyOf = (name) => (name.startsWith("minimap_sea_") ? "sea" : "land");
const tileEntry = (name) => `${TILE_DIRECTORY}/${name}.ytd`;
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();
const samePath = (left, right) =>
  Boolean(left && right) &&
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const defaultTools = () => ({
  native: callNativeEngine,
  extractEntries: extractRpfEntries,
  searchArchive: searchRpfArchive,
  readState: readStateShared,
  layerStatus: getAstralLayerStatus,
  archiveKeys: ({ stateDir }) =>
    archiveKeysDirectory({ stateDir, provision: provisionArchiveSupport }),
});

/* Копия кусками (`chunk-store.js`) — та же копия: печать из её описи. */
const stampOf = (file) => storedFileStamp(file);

/** Цель игры в состоянии Astral — по папке, а не по имени цели. */
async function gameTarget(gameRoot, stateDir, tools) {
  const state = await tools.readState(stateDir).catch(() => null);
  const targets =
    state?.targets && typeof state.targets === "object"
      ? Object.values(state.targets)
      : [];
  return targets.find((target) => samePath(target?.gameRoot, gameRoot)) || null;
}

/* Имя папки памяти: по цели, а без неё — по папке игры. Символы, которых
   Windows не терпит в именах, уходят. */
const memoryKey = (target, gameRoot) =>
  String(target?.id || path.resolve(gameRoot))
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 96);
const memoryRoot = (stateDir, key) => path.join(stateDir, STOCK_MEMORY, key);
const memoryFile = (stateDir, key) => path.join(memoryRoot(stateDir, key), "stock.json");

/**
 * Проверяет отчёт нативного хоста о плитках кандидата: ровно двенадцать
 * штатных плиток из update.rpf. Бросает с объяснением.
 */
export function verifyStockTiles(tiles) {
  const byName = new Map();
  for (const tile of Array.isArray(tiles) ? tiles : []) {
    const file = String(tile?.file || "").toLowerCase();
    const name = file.replace(/\.ytd$/, "");
    if (!STOCK_TILE_NAMES.includes(name)) continue;
    byName.set(name, tile);
  }
  for (const name of STOCK_TILE_NAMES) {
    const tile = byName.get(name);
    if (!tile) throw new Error(`нет плитки ${name}`);
    const archive = String(tile.archive || "")
      .split("\\")
      .join("/")
      .toLowerCase();
    if (archive !== UPDATE_ARCHIVE)
      throw new Error(`плитка ${name} лежит в ${archive || "неизвестном архиве"}`);
    const shape = STOCK_SHAPE[familyOf(name)];
    const width = Number(tile.width) || 0;
    const height = Number(tile.height) || 0;
    const levels = Number(tile.levels) || 1;
    const format = String(tile.format || "");
    if (width !== shape.side || height !== shape.side)
      throw new Error(`плитка ${name} — ${width}×${height}, штатная ${shape.side}²`);
    if (levels !== 1)
      throw new Error(`плитка ${name} несёт ${levels} уровней вместо одного`);
    if (format !== shape.format)
      throw new Error(`плитка ${name} записана как ${format}, штатная ${shape.format}`);
  }
  return STOCK_TILE_NAMES.map((name) => byName.get(name));
}

/**
 * Штатный ли фильм карты паузы: море штатного цвета и контуры на месте.
 * Astral прячет контуры все разом — значит, пустые ВСЕ контуры и есть след
 * нашей правки; один пустой контур бывает и у штатного файла.
 */
export function verifyStockPauseMap(buffer) {
  const model = resolvePauseMapModel(buffer);
  if (String(model.sea.color).toLowerCase() !== PAUSE_MAP_GAME_SEA)
    throw new Error(`море фильма карты паузы ${model.sea.color}, штатное ${PAUSE_MAP_GAME_SEA}`);
  if (
    model.overlays.length &&
    model.overlays.every((overlay) => !overlay.shapeIds?.length)
  )
    throw new Error("контуры фильма карты паузы пусты — они убраны Astral");
  return model;
}

async function hasZoomEntry(archivePath, gameRoot, tools) {
  const result = await tools.searchArchive({
    archivePath,
    query: "data/ui/mapzoomdata.meta",
    gameRoot,
    edition: "Legacy",
    maxMatches: 8,
    maxNestedDepth: 2,
  });
  return (result?.matches || []).some(
    (match) => normalizeEntry(match?.entry) === STOCK_ZOOM_ENTRY,
  );
}

const sameText = (left, right) =>
  String(left).replace(/\r\n/g, "\n").trim() ===
  String(right).replace(/\r\n/g, "\n").trim();

/** Один текстовый файл из архива — или null, когда его там нет. */
async function archiveText(archivePath, entry, gameRoot, scratch, tools, archiveTarget) {
  await fs.mkdir(scratch, { recursive: true });
  const result = await tools.extractEntries({
    archivePath,
    ...(archiveTarget ? { archiveTarget } : {}),
    entries: [entry],
    outputDirectory: scratch,
    gameRoot,
    edition: "Legacy",
  });
  const found = (result?.extracted || []).find(
    (item) => normalizeEntry(item?.entry) === normalizeEntry(entry),
  );
  const output = found?.output || path.join(scratch, path.basename(entry));
  const bytes = await fs.readFile(output).catch(() => null);
  return bytes ? bytes.toString("utf8") : null;
}

/**
 * Несёт ли архив НАШИ ступени приближения: файл в update.rpf есть и он не
 * повторяет штатный из common.rpf. Штатный текст поверх — это то, что кладёт
 * возврат штатной карты (убрать запись пакет не может), и это не правка.
 */
async function zoomDiffers(archivePath, gameRoot, scratch, tools) {
  if (!(await hasZoomEntry(archivePath, gameRoot, tools))) return false;
  const ours = await archiveText(
    archivePath,
    STOCK_ZOOM_ENTRY,
    gameRoot,
    path.join(scratch, "zoom-ours"),
    tools,
    UPDATE_ARCHIVE,
  );
  const stock = await archiveText(
    path.join(gameRoot, "common.rpf"),
    "data/ui/mapzoomdata.meta",
    gameRoot,
    path.join(scratch, "zoom-stock"),
    tools,
  );
  if (ours === null) return false;
  /* Штатный не прочитался — сравнить не с чем; файл в update.rpf считается
     правкой: так честнее, чем выдать его за штатный. */
  if (stock === null) return true;
  return !sameText(ours, stock);
}

/** Сырые байты плиток и фильма из архива — по записям, одной партией. */
async function rawEntries(archivePath, gameRoot, outputDirectory, tools) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const entries = [...STOCK_TILE_NAMES.map(tileEntry), WORLD_MAP_PAUSE_ENTRY];
  const result = await tools.extractEntries({
    archivePath,
    archiveTarget: UPDATE_ARCHIVE,
    entries,
    outputDirectory,
    gameRoot,
    edition: "Legacy",
  });
  const outputs = new Map(
    (result?.extracted || []).map((item) => [
      normalizeEntry(item?.entry),
      String(item?.output || ""),
    ]),
  );
  const buffers = {};
  for (const entry of entries) {
    const output =
      outputs.get(normalizeEntry(entry)) ||
      path.join(outputDirectory, path.basename(entry));
    const bytes = await fs.readFile(output).catch(() => null);
    if (!bytes) throw new Error(`в архиве нет ${entry}`);
    buffers[normalizeEntry(entry)] = bytes;
  }
  return buffers;
}

async function readMemory(stateDir, key) {
  try {
    const record = JSON.parse(await fs.readFile(memoryFile(stateDir, key), "utf8"));
    if (record?.schema !== 1) return null;
    if (!Array.isArray(record.tiles) || record.tiles.length !== STOCK_TILE_NAMES.length)
      return null;
    for (const tile of record.tiles) {
      const ytd = await fs.readFile(tile.ytd).catch(() => null);
      if (!ytd || sha256(ytd) !== tile.sha256) return null;
      if (!(await stampOf(tile.png))) return null;
    }
    const movie = await fs.readFile(record.movie?.file || "").catch(() => null);
    if (!movie || sha256(movie) !== record.movie.sha256) return null;
    return record;
  } catch {
    return null;
  }
}

async function remember(stateDir, key, candidate, tiles, buffers) {
  const root = memoryRoot(stateDir, key);
  const tilesRoot = path.join(root, "tiles");
  await fs.mkdir(tilesRoot, { recursive: true });
  const remembered = [];
  for (const tile of tiles) {
    const name = String(tile.file).toLowerCase().replace(/\.ytd$/, "");
    const entry = tileEntry(name);
    const bytes = buffers[normalizeEntry(entry)];
    const ytd = path.join(tilesRoot, `${name}.ytd`);
    const png = path.join(tilesRoot, `${name}.png`);
    await fs.writeFile(ytd, bytes);
    await fs.copyFile(tile.png, png);
    remembered.push({
      name,
      file: `${name}.ytd`,
      entry,
      archive: UPDATE_ARCHIVE,
      width: Number(tile.width) || 0,
      height: Number(tile.height) || 0,
      levels: Number(tile.levels) || 1,
      format: String(tile.format || ""),
      bytes: bytes.length,
      sha256: sha256(bytes),
      ytd,
      png,
    });
  }
  const movieBytes = buffers[normalizeEntry(WORLD_MAP_PAUSE_ENTRY)];
  const movieFile = path.join(root, "minimap_main_map.gfx");
  await fs.writeFile(movieFile, movieBytes);
  const record = {
    schema: 1,
    source: candidate.source,
    archivePath: path.resolve(candidate.archivePath),
    archiveStamp: await stampOf(candidate.archivePath),
    rememberedAt: new Date().toISOString(),
    tiles: remembered,
    movie: {
      entry: WORLD_MAP_PAUSE_ENTRY,
      file: movieFile,
      bytes: movieBytes.length,
      sha256: sha256(movieBytes),
    },
  };
  const temporary = `${memoryFile(stateDir, key)}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await fs.rename(temporary, memoryFile(stateDir, key));
  return record;
}

/** Первая копия архива, снятая при подготовке слоя. */
const ORIGINAL_COPY = "update-update.rpf.original.rpf";

/**
 * Кандидаты по порядку доверия: основа движка, остальные копии в его памяти
 * (от новой к старой), живой архив. Композиции (`*.composition.rpf`) — это
 * основа плюс наши слои, в них искать нечего.
 */
async function stockCandidates(gameRoot, stateDir, target, tools) {
  const candidates = [];
  const status = target
    ? await tools.layerStatus({ targetId: target.id, stateDir }).catch(() => null)
    : null;
  const basePath = status?.backup?.path || null;
  if (basePath && (await stampOf(basePath)))
    candidates.push({ source: "astral-base", archivePath: basePath });
  if (target?.id) {
    const root = path.join(stateDir, "bases", String(target.id));
    const copies = [];
    const consider = async (archivePath, source) => {
      if (samePath(archivePath, basePath)) return;
      const stamp = await stampOf(archivePath);
      if (stamp) copies.push({ archivePath, source, mtimeMs: stamp.mtimeMs });
    };
    await consider(path.join(root, ORIGINAL_COPY), "astral-original");
    const rebases = path.join(root, "update-rebases");
    const names = new Set(
      (await fs.readdir(rebases).catch(() => [])).map((name) => (name.endsWith(PACKED_SUFFIX) ? name.slice(0, -PACKED_SUFFIX.length) : name)),
    );
    for (const name of names)
      if (/^[a-f0-9]{64}\.rpf$/i.test(name))
        await consider(path.join(rebases, name), "astral-rebase");
    copies.sort((left, right) => right.mtimeMs - left.mtimeMs);
    for (const item of copies)
      candidates.push({ source: item.source, archivePath: item.archivePath });
  }
  const livePath = path.join(gameRoot, "update", "update.rpf");
  if (await stampOf(livePath))
    candidates.push({ source: "game", archivePath: livePath });
  return candidates;
}

async function inspectCandidate(candidate, { gameRoot, stateDir, context, key }, tools) {
  await ensureStoredFile(candidate.archivePath);
  const scratch = path.join(memoryRoot(stateDir, key), "inspect", randomUUID());
  await fs.mkdir(scratch, { recursive: true });
  try {
    if (await zoomDiffers(candidate.archivePath, gameRoot, path.join(scratch, "zoom"), tools))
      throw new Error("несёт файл ступеней приближения Astral");
    const keys = await tools.archiveKeys({ stateDir });
    const extracted = await tools.native(
      "extract-map-tiles",
      {
        gameRoot,
        output: path.join(scratch, "tiles"),
        keys,
        baseArchive: candidate.archivePath,
      },
      context,
    );
    const manifest = extracted?.map ?? extracted;
    const tiles = verifyStockTiles(manifest?.tiles);
    const buffers = await rawEntries(
      candidate.archivePath,
      gameRoot,
      path.join(scratch, "raw"),
      tools,
    );
    verifyStockPauseMap(buffers[normalizeEntry(WORLD_MAP_PAUSE_ENTRY)]);
    /* Именно `return await`: без него `finally` снёс бы временную папку,
       пока копирование картинок ещё идёт. */
    return await remember(stateDir, key, candidate, tiles, buffers);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Штатная карта этой игры: из памяти, а впервые — из первого чистого
 * кандидата по порядку доверия. Отвергнутые кандидаты возвращаются с
 * причинами: когда штатной карты нет нигде, человеку важно знать почему.
 *
 * @returns {Promise<{record: object|null, rejected: object[]}>}
 */
export async function findStockWorldMap(
  { gameRoot, stateDir, context = null },
  tools = {},
) {
  const merged = { ...defaultTools(), ...tools };
  const target = await gameTarget(gameRoot, stateDir, merged);
  const key = memoryKey(target, gameRoot);
  const remembered = await readMemory(stateDir, key);
  if (remembered) return { record: { ...remembered, remembered: true }, rejected: [] };
  const rejected = [];
  for (const candidate of await stockCandidates(gameRoot, stateDir, target, merged)) {
    try {
      const record = await inspectCandidate(
        candidate,
        { gameRoot, stateDir, context, key },
        merged,
      );
      return { record: { ...record, remembered: false }, rejected };
    } catch (error) {
      rejected.push({
        source: candidate.source,
        archivePath: candidate.archivePath,
        reason: String(error?.message || error),
      });
    }
  }
  return { record: null, rejected };
}

/**
 * Запись памяти штатной карты (`tiles`, `movie`, `source`, `archivePath`)
 * или null, когда штатной карты нет нигде — тогда честнее сказать это
 * человеку, чем выдать за неё изменённую.
 */
export async function resolveStockWorldMap(input, tools = {}) {
  const { record, rejected } = await findStockWorldMap(input, tools);
  return record ? { ...record, rejected } : null;
}

/**
 * Насколько архив отличается от штатной карты: сколько плиток не совпадает,
 * другой ли фильм карты паузы, лежит ли в архиве файл ступеней приближения.
 * `clean` — всё штатное.
 */
export async function compareWithStock(
  archivePath,
  stock,
  { gameRoot, stateDir },
  tools = {},
) {
  const merged = { ...defaultTools(), ...tools };
  const scratch = path.join(stateDir, STOCK_MEMORY, "compare", randomUUID());
  try {
    const buffers = await rawEntries(archivePath, gameRoot, scratch, merged);
    const tiles = stock.tiles.filter(
      (tile) => sha256(buffers[normalizeEntry(tile.entry)]) !== tile.sha256,
    ).length;
    const movie =
      sha256(buffers[normalizeEntry(WORLD_MAP_PAUSE_ENTRY)]) !== stock.movie.sha256;
    const zoom = await zoomDiffers(archivePath, gameRoot, path.join(scratch, "zoom"), merged);
    return { path: archivePath, tiles, movie, zoom, clean: !tiles && !movie && !zoom };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Что показывает игра сейчас (живой архив) и к чему она вернётся после
 * снятия карты (основа движка) — против штатной карты.
 */
export async function stockWorldMapStatus(
  { gameRoot, stateDir, context = null },
  tools = {},
) {
  const merged = { ...defaultTools(), ...tools };
  const { record: stock, rejected } = await findStockWorldMap(
    { gameRoot, stateDir, context },
    merged,
  );
  const target = await gameTarget(gameRoot, stateDir, merged);
  const status = target
    ? await merged.layerStatus({ targetId: target.id, stateDir }).catch(() => null)
    : null;
  const basePath = status?.backup?.path || null;
  const livePath = path.join(gameRoot, "update", "update.rpf");
  const describe = async (archivePath) =>
    stock && archivePath && (await ensureStoredFile(archivePath)) && (await stampOf(archivePath))
      ? compareWithStock(archivePath, stock, { gameRoot, stateDir }, merged)
      : null;
  return {
    stock: stock
      ? {
          source: stock.source,
          archivePath: stock.archivePath,
          rememberedAt: stock.rememberedAt,
        }
      : null,
    rejected,
    base: await describe(basePath),
    live: await describe(livePath),
  };
}
