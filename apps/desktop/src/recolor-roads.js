/*
 * «Дороги» — сборка пакета (задача 6 ТЗ 07.10.2026).
 *
 * Своих файлов у дорог нет: установщик правит файлы карты игрока. Какие —
 * знает опись (`inventory/roads.js`): около полутора тысяч словарей с
 * листами асфальта, грунтовок, тротуаров и разметки — общие словари
 * `gtxd.rpf` и их копии `+hi`, дальние планы (`_lod`, `slod`) и словари
 * районов — и сотни моделей, у которых лист дороги встроен внутрь (ТЗ
 * 17.10.2026, вечер, задача 1). Каждый файл берётся оттуда, откуда его берёт игра
 * (`censusMapTextures`: база < update.rpf и контейнеры работ Astral < пакеты
 * Rockstar по порядку), — так на месте остаются и обновления Rockstar, и
 * правки других работ Astral (вода, фонари) в тех же словарях.
 *
 * В пакет идут только словари, где хоть один лист изменился: работа «только
 * разметка» трогает листы разметки и листы асфальта с нарисованными линиями
 * (метка описи), остальное остаётся как в игре.
 *
 * Собранный словарь помнится под ключом «версия сборки + источник в игре +
 * облик частей, что в нём есть» (`recolor/roads/cache`): смена цвета
 * тротуаров не пересобирает асфальт, повтор «Применить» — не собирает
 * ничего. Файлы пакета — жёсткие ссылки на память (движок кладёт их в
 * хранилище тоже ссылкой: `mayStoreByLink`), память пишется новым файлом и
 * не переписывается.
 */

import fs from "node:fs/promises";
import { composedUnreadableError } from "./composed-source-error.js";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import inventory from "@modovik/climb-contract/recolor/inventory/roads";
import {
  normalizeRoadsProject,
  roadsChangedParts,
  roadsDictionaryWanted,
  roadsProjectIsStock,
  roadsProjectSignature,
  applyRoadsStandard,
  ROAD_GROUP_ALL,
  ROAD_GROUP_IDS,
  ROAD_PART_IDS,
} from "@modovik/climb-contract/recolor/roads";
import { buildRoadsManifest, isLocalRoadsManifest } from "@modovik/install-engine/roads-manifest-trust.js";
import { buildRoadsContainerManifest, isLocalRoadsContainerManifest } from "@modovik/install-engine/roads-container-manifest-trust.js";
import { buildRoadsCarrierManifest, isLocalRoadsCarrierManifest } from "@modovik/install-engine/roads-carrier-manifest-trust.js";
import { assertRoadsBuilt, planRoadsContainer, replaceRoadsBuilt } from "./roads-update-install.js";
import { isRoadsMapFile } from "@modovik/install-engine/roads-dlc.js";
import { gameMapNames } from "./game-map-names.js";
import { roadsMapCandidates } from "./map-name-candidates.js";
import { censusMapTextures, jsonHashMemo } from "./texture-census.js";
import { createRoadsContext, processRoadsDictionary, ROADS_BUILD_VERSION } from "./roads-build.js";
import { WorkerPoolBroken, createWorkerPool, workerPoolSize } from "./worker-pool.js";
import { copyBuiltFile, writeBuiltFile } from "@modovik/install-engine/built-file-write.js";
import { buildRoadsOnEngine, roadsEngineEnabled, roadsEngineFamilies, roadsEngineLookRequest, roadsEngineThreads } from "./roads-engine-build.js";
import { archiveListingEnabled, listGameArchives } from "./game-archive-listing.js";

const WORKER_URL = new URL("./roads-build-worker.js", import.meta.url);
/* Сколько прежних сборок держит память: текущая и одна до неё. */
const KEEP_BUILDS = 2;
/* Сколько ссылок пакета кладётся разом. */
const LINK_BATCH = 32;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Пул потоков сборки дорог; `ASTRAL_ROADS_WORKERS=0` — без потоков. */
export function createRoadsPool({ project, images = new Map(), size = workerPoolSize("ASTRAL_ROADS_WORKERS") } = {}) {
  return createWorkerPool({ url: WORKER_URL, workerData: { project, images: [...images] }, size, label: "сборки дорог" });
}

/**
 * Пул потоков, что поднимается по первому заданию (14.11.2026, работа «Astral быстрее»). Словари собирает движок, потоки JS — запасной путь
 * для двух-трёх словарей из двух с половиной тысяч: поднятые заранее, шесть потоков всю сборку движка стояли без дела и держали память.
 */
export function lazyRoadsPool({ project, images = new Map(), size = workerPoolSize("ASTRAL_ROADS_WORKERS") } = {}) {
  if (!(size >= 1)) return null;
  let real = null;
  return {
    size,
    run(job, bytes) {
      real ||= createRoadsPool({ project, images, size });
      return real ? real.run(job, bytes) : Promise.reject(new WorkerPoolBroken("Потоки сборки дорог не поднялись."));
    },
    async close() {
      await real?.close();
    },
  };
}

/*
 * Облик частей и групп разметки, что есть в файле: ключ памяти. Разметка
 * нужна и файлу с асфальтом, и с тротуаром — листы асфальта держат свои
 * линии, листы бордюра — жёлтую краску; но только групп, что на них есть:
 * смена цвета переходов не пересобирает словари без зебры.
 */
function lookKey(textures, signature) {
  const parts = new Set(textures.map((texture) => texture[1]));
  const look = {};
  for (const part of ROAD_PART_IDS) if (parts.has(part)) look[part] = signature.parts[part];
  if (parts.has("markings") || parts.has("asphalt") || parts.has("sidewalk")) {
    const mask = textures.reduce((sum, texture) => sum | (Number.isInteger(texture[4]) ? texture[4] : ROAD_GROUP_ALL), 0);
    look.markings = Object.fromEntries(ROAD_GROUP_IDS.map((id, index) => [id, mask & (1 << index) ? (signature.markings?.[id] ?? null) : null]));
  }
  return look;
}

/* Модель карты (а не словарь) — по расширению. */
const isModelFile = (name) => /\.(?:ydr|ydd|yft)$/.test(name);

async function readIndex(file) {
  try {
    const index = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(index?.builds) ? index : { builds: [] };
  } catch {
    return { builds: [] };
  }
}

async function writeAtomic(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  /* Запись собранного — под потолком и отдыхом диска обычного режима (`built-file-write.js`, 18.11.2026); короткие заметки и опись — как были. */
  if (typeof bytes === "string") await fs.writeFile(temporary, bytes);
  else await writeBuiltFile(temporary, bytes);
  await fs.rename(temporary, file).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => {});
    /* Тот же ключ уже собран другой сборкой — файл тот же. */
    if (!(await fs.stat(file).catch(() => null))) throw error;
  });
}

/* Ссылка на память в пакете; другой том — копия, под тормозом записи. */
async function linkOrCopy(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.link(from, to);
  } catch {
    await copyBuiltFile(from, to);
  }
}

/**
 * Пакет дорог под работу: `{ setId, manifest, packageRoot, project, summary,
 * payloadFiles }`. `game` — читатель игры (`read(at)`), `census` — перепись
 * карты (по умолчанию — по игре `gameRoot`), `pool` — пул потоков или
 * `null`. Дороги как в игре — отказ: ставить нечего, снимается «Откатить».
 */
export async function buildRoadsPackage(
  input,
  stateDir,
  {
    game,
    gameRoot = "",
    keys = null,
    census = null,
    pool: givenPool = null,
    /* Пул под работу, какой она станет после плана контейнера (`container`): потоки JS собирают то, что осталось в работе. */
    poolOf = null,
    /* GTA 5 RP: дороги в контейнеры `update.rpf` (`roads-update-install.js`): `{ updateLength, reclaimBytes, standingPacks }` или `null` — пакеты, как всегда. */
    container = null,
    /* Файлы других работ Astral (растительность, билборды, места), поверх которых дороги собираются: `Map<имя, { at, owner }>`; пусто — всё из игры (`astralSetFiles`, `recolor-customizer.js`). */
    composed = new Map(),
    images = new Map(),
    onProgress = null,
    files = [...inventory.files, ...(inventory.models || [])],
    mapNames: givenMapNames = undefined,
    /* Движок сборки (`roads-engine-build.js`): `{ executable, keysDirectory, threads?, onSpawn?, scratch? }` или `null` — только потоки JS. `scratch` — корень рабочих папок движка от хозяина сборки. */
    engine = null,
    /* Глубина повторной сборки после перекладки по собранному (`__depth`): отброшенная часть возвращается к штатной, затронутые общие словари собираются заново. */
    __depth = 0,
  } = {},
) {
  let project = normalizeRoadsProject(input);
  if (roadsProjectIsStock(project)) throw new Error("Дороги как в игре — ставить нечего: снимите свои дороги «Откатить».");
  if (!game) throw new Error("Дороги собираются из файлов вашей игры — подключите GTA V.");
  let changed = roadsChangedParts(project);
  let wanted = files.filter((file) => roadsDictionaryWanted(file.textures, changed));
  const hashMemo = jsonHashMemo(path.join(stateDir || os.tmpdir(), "recolor", "roads", "census-hashes.json"));
  /* Куда ушло время сборки: перепись карты, движок, всё остальное — в сводке (`timings`), стенды печатают. */
  const clock = { from: Date.now(), listingMs: 0, censusMs: 0, engineMs: 0, engine: null, filesMs: 0, mapNamesMs: 0, packageMs: 0 };
  const lap = (from) => Date.now() - from;
  /* Оглавления архивов игры — из движка одним запуском (`game-archive-listing.js`): ими пользуются и перепись карты, и поиск имён сетевой
     карты ниже. Не вышло (нет движка, отказ) — оба читают игру прежним читателем. */
  const useEngine = Boolean(engine?.executable) && roadsEngineEnabled();
  const listing =
    useEngine && archiveListingEnabled() && (!census || givenMapNames === undefined)
      ? await listGameArchives({
          executable: engine.executable,
          gameRoot,
          keysDirectory: engine.keysDirectory || "",
          threads: engine.threads ?? roadsEngineThreads(),
          onSpawn: engine.onSpawn,
          scratchRoot: engine.scratch,
        }).catch(() => null)
      : null;
  clock.listingMs = lap(clock.from);
  const listed = listing ? { open: listing.open } : {};
  const taken = census || (await censusMapTextures({ gameRoot, keys, hashMemo, ...listed, ...(listing?.updateHashes ? { updateHashes: listing.updateHashes } : {}) }));
  clock.censusMs = lap(clock.from) - clock.listingMs;
  const byName = new Map(taken.items.filter((item) => item.kind === "dictionary" || item.kind === "model").map((item) => [item.name, item]));
  /* Общее имя, что уже занято другой работой Astral, собирается ПОВЕРХ её файла, а не штатного: её контейнер монтируется выше или ниже и перекрыл бы дорожную копию штатным видом (или наоборот). Источник и ключ памяти — её файл (`owner` несёт отпечаток её состава); движок такие словари не берёт (читает игру сам), их собирают потоки JS. */
  for (const [name, other] of composed) {
    const item = byName.get(name);
    if (item && other?.at) byName.set(name, { ...item, at: other.at, identity: `${item.identity}|over:${other.owner}`, over: true, who: other.owner });
  }
  /* Контейнер `update.rpf`: до сборки и записи — какие группы разметки влезают; не влезшее остаётся «как в игре», отказ — ошибкой до любой записи. */
  const viaUpdate = container ? planRoadsContainer({ project, files, sizeOf: (name) => byName.get(name)?.size, ...container }) : null;
  if (viaUpdate) {
    project = viaUpdate.project;
    changed = roadsChangedParts(project);
    wanted = viaUpdate.wanted;
  }
  const pool = givenPool || (viaUpdate && poolOf ? poolOf(project) : null);
  const signature = JSON.parse(roadsProjectSignature(project));
  const root = path.join(stateDir || os.tmpdir(), "recolor", "roads");
  const cache = path.join(root, "cache");
  await fs.mkdir(cache, { recursive: true });
  let context = null;
  const inline = () => (context ||= createRoadsContext(project, images));
  let poolAlive = Boolean(pool);

  const report = { dictionaries: 0, built: 0, reused: 0, unchanged: 0, missing: 0, failed: [], skipped: 0, textures: 0, bytes: 0, sheetsFromMemory: 0, sheetsComputed: 0, fromEngine: 0 };
  const described = [];
  const keysUsed = [];
  let done = 0;
  const step = () => {
    done += 1;
    if (done % 8 === 0 || done === wanted.length) onProgress?.({ step: "roads", done, total: wanted.length });
  };

  const keyOf = (file, item) =>
    sha256(JSON.stringify({ version: ROADS_BUILD_VERSION, name: file.name, source: `${item.at}|${item.identity}`, look: lookKey(file.textures, signature) }));
  /* Словарь уже собран прошлой сборкой: запись памяти и файл на месте. */
  const knownOf = async (stored, note) => {
    const known = await fs.readFile(note, "utf8").then(JSON.parse).catch(() => null);
    return known && (known.unchanged || (await fs.stat(stored).catch(() => null))?.size === known.size) ? known : null;
  };

  /*
   * Сначала — движок (14.11.2026): словари, которых нет в памяти сборок, он читает из игры сам и собирает с одной памятью готовых листов на
   * все потоки; файл выходит тем же байт в байт. Что он не взял (`fallback`), не смог (отказ запуска) или чего не умеет (облик с эффектом
   * цвета) — собирают потоки JS ниже, как раньше.
   */
  const fromEngine = new Map();
  /* Словари, что движок отдал приложению (и почему): видно в сводке сборки. */
  const engineFallbacks = [];
  if (useEngine) {
    const request = roadsEngineLookRequest(project, inline().sources);
    const jobs = [];
    if (request)
      for (const file of wanted) {
        const item = byName.get(file.name);
        if (!item || item.over) continue;
        const key = keyOf(file, item);
        const stored = path.join(cache, `${key}.ytd`);
        if (!(await knownOf(stored, path.join(cache, `${key}.json`)))) jobs.push({ name: file.name, at: item.at, output: stored });
      }
    if (jobs.length) {
      const before = wanted.length - jobs.length;
      const engineFrom = Date.now();
      try {
        const results = await buildRoadsOnEngine({
          executable: engine.executable,
          gameRoot,
          keysDirectory: engine.keysDirectory || "",
          request,
          families: roadsEngineFamilies(wanted),
          jobs,
          threads: engine.threads ?? roadsEngineThreads(),
          onSpawn: engine.onSpawn,
          scratchRoot: engine.scratch,
          onProgress: (progress) => onProgress?.({ step: "roads", done: before + progress.done, total: wanted.length }),
          onTimings: (stages) => {
            clock.engine = stages;
          },
        });
        results.forEach((result, index) => {
          if (result.status !== "fallback") fromEngine.set(jobs[index].name, result);
          else engineFallbacks.push({ name: jobs[index].name, reason: String(result.reason || "").slice(0, 160) });
        });
      } catch (error) {
        /* Движок не поднялся или упал: словари собирают потоки JS. */
        fromEngine.clear();
        engineFallbacks.push({ name: "*", reason: String(error?.message || error).slice(0, 160) });
      }
      clock.engineMs = Date.now() - engineFrom;
    }
  }
  /* Словари движка в счёте хода уже есть: дальше счёт идёт с них, а не с нуля. */
  done = fromEngine.size;

  const buildOne = async (file) => {
    const item = byName.get(file.name);
    if (!item) {
      report.missing += 1;
      return;
    }
    const key = keyOf(file, item);
    const stored = path.join(cache, `${key}.ytd`);
    const note = path.join(cache, `${key}.json`);
    const taken = fromEngine.get(file.name);
    if (taken) {
      if (taken.status === "missing") {
        report.missing += 1;
        return;
      }
      report.skipped += taken.skipped || 0;
      report.sheetsFromMemory += taken.memo || 0;
      report.sheetsComputed += taken.computed || 0;
      report.fromEngine += 1;
      keysUsed.push(key);
      if (taken.status === "unchanged") {
        report.unchanged += 1;
        await writeAtomic(note, JSON.stringify({ unchanged: true }));
        return;
      }
      await writeAtomic(note, JSON.stringify({ size: taken.bytes, sha256: taken.sha256, textures: taken.textures.length }));
      report.built += 1;
      report.textures += taken.textures.length;
      described.push({ name: file.name, size: taken.bytes, sha256: taken.sha256, stored });
      return;
    }
    const known = await knownOf(stored, note);
    if (known) {
      keysUsed.push(key);
      if (known.unchanged) report.unchanged += 1;
      else {
        report.reused += 1;
        report.textures += known.textures || 0;
        described.push({ name: file.name, size: known.size, sha256: known.sha256, stored });
      }
      return;
    }
    const bytes = await game.read(item.at).catch(() => null);
    /* Файл другой работы, поверх которого собираем, не читается: не молча штатное (брак), а отказ словами. */
    if (!bytes && item.over) throw composedUnreadableError(file.name, item.at, "roads");
    if (!bytes) {
      report.missing += 1;
      return;
    }
    let result = null;
    if (poolAlive) {
      try {
        result = await pool.run({ name: file.name }, new Uint8Array(bytes));
      } catch (error) {
        if (!(error instanceof WorkerPoolBroken)) throw new Error(`Словарь ${file.name}: ${String(error?.message || error)}`);
        poolAlive = false;
      }
    }
    if (!result) {
      const local = processRoadsDictionary(new Uint8Array(bytes), file.name, inline());
      result = { bytes: local.bytes, sha256: local.bytes ? sha256(local.bytes) : null, textures: local.textures, skipped: local.skipped, sheets: local.sheets };
    }
    report.skipped += result.skipped || 0;
    report.sheetsFromMemory += result.sheets?.memo || 0;
    report.sheetsComputed += result.sheets?.computed || 0;
    keysUsed.push(key);
    if (!result.bytes) {
      report.unchanged += 1;
      await writeAtomic(note, JSON.stringify({ unchanged: true }));
      return;
    }
    await writeAtomic(stored, result.bytes);
    await writeAtomic(note, JSON.stringify({ size: result.bytes.length, sha256: result.sha256, textures: result.textures.length }));
    report.built += 1;
    report.textures += result.textures.length;
    described.push({ name: file.name, size: result.bytes.length, sha256: result.sha256, stored });
  };

  /* Словари идут потоками: пока пул собирает одни, другие читаются. */
  const filesFrom = Date.now();
  const queue = [...wanted];
  const lanes = Math.max(1, poolAlive ? pool.size + 1 : 1);
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        try {
          await buildOne(file);
        } catch (error) {
          report.failed.push({ name: file.name, reason: String(error?.message || error).slice(0, 200) });
        }
        if (!fromEngine.has(file.name)) step();
      }
    }),
  );
  clock.filesMs = lap(filesFrom);
  if (report.failed.length && !described.length) throw new Error(`Дороги не собрались: ${report.failed[0].reason}`);
  if (!described.length) throw new Error("Правка дорог не меняет ни одного словаря игры — ставить нечего.");

  described.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  report.dictionaries = described.length;
  report.bytes = described.reduce((sum, file) => sum + file.size, 0);
  /* Файлы без `hei_`, что игра включает только наборами `GROUP_MAP` (26.10.2026: 22 из 2442 у «Неоновой ночи»), — в архив сетевой карты, как `hei_`. Список — из игры игрока
     (`game-map-names.js`, кэш по отпечатку игры); не прочитался — прежнее правило `hei_`. `mapNames: null` — не читать (тесты). */
  const mapNamesFrom = Date.now();
  const mapNames =
    viaUpdate
      ? null
      : givenMapNames !== undefined
      ? givenMapNames
      : (await gameMapNames({ gameRoot, keys, candidates: roadsMapCandidates(), stateDir, ...listed }).catch(() => null))?.names || null;
  clock.mapNamesMs = lap(mapNamesFrom);
  const packageFrom = Date.now();
  let outline = described.map(({ name, size, sha256: hash }) => ({ name, size, sha256: hash }));
  /* Собранное — по настоящим файлам, до первой записи в игру: не влезло — отказ, `update.rpf` не тронут. */
  if (viaUpdate) {
    const checkBuilt = (list, placement, perCarrier) => assertRoadsBuilt({ files: list, budget: viaUpdate.budget, carrier: viaUpdate.carrier === true, ...(placement ? { placement, budgets: Object.fromEntries(Object.entries(perCarrier || {}).map(([id, item]) => [id, item.budget])) } : {}) });
    try {
      checkBuilt(outline, viaUpdate.placement, viaUpdate.perCarrier);
    } catch (error) {
      /* Собранное больше плана (перекрашенные файлы тяжелее штатных): не отказываем всей работе, а перекладываем раскладку по настоящим размерам (ступень 1.1); не влезла и разметка — отказ, как был. */
      if (!(viaUpdate.carrier === true && viaUpdate.placement && viaUpdate.stageFiles)) throw error;
      const replaced = replaceRoadsBuilt({ files: outline, plan: viaUpdate });
      /* Часть отброшена ПОСЛЕ сборки: общие словари «разметка + эта часть» уже несут перекрашенные листы части, а на экране она «как в игре». Проект без этой части собирается заново: словари с прежним
         обликом берутся из памяти сборок (облик в ключе — на файл), пересобираются только затронутые; размеры и проверка собранного считаются заново. Пул старого проекта для этого не годится. */
      const newlyDropped = replaced.droppedParts.filter((part) => !viaUpdate.droppedParts.includes(part));
      if (newlyDropped.length && __depth < 3 && (!givenPool || poolOf)) {
        let adjusted = project;
        for (const part of newlyDropped) adjusted = applyRoadsStandard(adjusted, part);
        const again = await buildRoadsPackage(adjusted, stateDir, { game, gameRoot, keys, census, pool: null, poolOf, container, images, onProgress, files, mapNames: givenMapNames, engine, __depth: __depth + 1 });
        const via = again.summary?.viaUpdate;
        if (via) {
          via.droppedParts = [...new Set([...viaUpdate.droppedParts, ...via.droppedParts, ...newlyDropped])];
          via.lines = [...new Set([...(viaUpdate.lines || []), ...replaced.lines.filter((line) => !(viaUpdate.lines || []).includes(line)), ...(via.lines || [])])];
        }
        return again;
      }
      checkBuilt(replaced.files, replaced.placement, replaced.perCarrier);
      const keep = new Set(replaced.files.map((file) => file.name.toLowerCase()));
      outline = replaced.files;
      for (let index = described.length - 1; index >= 0; index -= 1) if (!keep.has(String(described[index].name).toLowerCase())) described.splice(index, 1);
      viaUpdate.placement = replaced.placement;
      viaUpdate.droppedParts = replaced.droppedParts;
      viaUpdate.lines = replaced.lines;
      viaUpdate.perCarrier = replaced.perCarrier;
      viaUpdate.stages = replaced.stages;
    }
  }
  /* Носители по таблице (`carrier-targets.js`): файл несёт id носителя, где его план положил (у update2 — как раньше). */
  const carrierOfFile = new Map(viaUpdate?.placement || []);
  if (carrierOfFile.size) for (const file of outline) file.carrier = carrierOfFile.get(file.name.toLowerCase()) ?? "update2";
  /* Носитель `update2.rpf`: своя контейнерная форма манифеста дорог (`roads-carrier-manifest-trust.js`). */
  const carrierMode = viaUpdate?.carrier === true;
  const manifest = carrierMode ? buildRoadsCarrierManifest(outline) : viaUpdate ? buildRoadsContainerManifest(outline) : buildRoadsManifest(outline, { mapNames });
  if (carrierMode && !isLocalRoadsCarrierManifest(manifest, "Legacy")) throw new Error("Собранные дороги не прошли строгую проверку доверия носителя update2.rpf.");
  if (viaUpdate && !carrierMode && !isLocalRoadsContainerManifest(manifest, "Legacy")) throw new Error("Собранные дороги не прошли строгую проверку доверия контейнера update.rpf.");
  if (!viaUpdate && !isLocalRoadsManifest(manifest, "Legacy")) throw new Error("Собранные дороги не прошли строгую проверку доверия (вес пакета или имена словарей).");
  const packageRoot = path.join(root, "packages", `${manifest.roads.sourceDigest.slice(7, 23)}-${randomUUID().slice(0, 8)}`);
  /* Ссылки пакета — пачками: две с половиной тысячи ссылок по одной шли секунды. Папка — заранее, чтобы пачка не создавала её наперегонки. */
  await fs.mkdir(path.join(packageRoot, "payload"), { recursive: true });
  for (let from = 0; from < described.length; from += LINK_BATCH)
    await Promise.all(described.slice(from, from + LINK_BATCH).map((file) => linkOrCopy(file.stored, path.join(packageRoot, "payload", file.name))));

  /* Память: эта сборка и предыдущая, остальное — прочь. */
  const indexFile = path.join(cache, "index.json");
  const index = await readIndex(indexFile);
  index.builds = [keysUsed, ...index.builds].slice(0, KEEP_BUILDS);
  await writeAtomic(indexFile, JSON.stringify(index));
  const keep = new Set(index.builds.flat());
  for (const entry of await fs.readdir(cache).catch(() => [])) {
    const match = /^([a-f0-9]{64})\.(?:ytd|json)$/.exec(entry);
    if (match && !keep.has(match[1])) await fs.rm(path.join(cache, entry), { force: true }).catch(() => {});
  }

  return {
    setId: "roads",
    manifest,
    packageRoot,
    project,
    payloadFiles: described.map(({ name, sha256: hash }) => ({ name, sha256: hash })),
    summary: {
      dictionaries: report.dictionaries,
      textures: report.textures,
      built: report.built,
      reused: report.reused,
      unchanged: report.unchanged,
      missing: report.missing,
      skipped: report.skipped,
      /* Листы новых словарей: взятые из памяти готовых листов и посчитанные (`roads-build.js`): один лист лежит в десятках словарей. */
      sheetsFromMemory: report.sheetsFromMemory,
      sheetsComputed: report.sheetsComputed,
      /* Сколько словарей собрал движок (`roads-build`); остальные — потоки JS. */
      fromEngine: report.fromEngine,
      ...(engineFallbacks.length ? { engineFallbacks: engineFallbacks.slice(0, 8) } : {}),
      /* Отпечаток состава пакета (имена, размеры и SHA-256 файлов): по нему стенды сверяют, что сборка та же байт в байт. */
      sourceDigest: manifest.roads.sourceDigest,
      /* Дороги в `update.rpf` (GTA 5 RP): что влезло, что снято («как в игре»), сколько и в каком бюджете; строки — в журнал приложения. */
      ...(viaUpdate
        ? {
            viaUpdate: {
              chosen: viaUpdate.chosen,
              refused: viaUpdate.refused,
              droppedParts: viaUpdate.droppedParts,
              bytes: viaUpdate.bytes,
              budget: viaUpdate.budget,
              lines: viaUpdate.lines,
              ...(viaUpdate.carrier === true ? { carrier: true } : {}),
              /* Полосы, где легли файлы (id носителей): метка записи в сводке работы называет настоящую полосу, а не `x64/astral` у update2. */
              ...(viaUpdate.placement?.length ? { lanes: [...new Set(viaUpdate.placement.map(([, id]) => id))] } : {}),
            },
          }
        : {}),
      /* `listingMs` — оглавления архивов игры из движка (без него — ноль, архивы открывают перепись и поиск имён); `filesMs` — записи памяти и словари, что собрал JS; `mapNamesMs` — имена сетевой карты из игры; `packageMs` — манифест, ссылки пакета и уборка памяти. */
      timings: {
        listingMs: clock.listingMs,
        censusMs: clock.censusMs,
        engineMs: clock.engineMs,
        /* Этапы внутри движка, время потоков суммой: чтение, разбор, листы (разбор блоков, пиксели, сжатие блоков), deflate, запись. */
        ...(clock.engine ? { engine: clock.engine } : {}),
        filesMs: clock.filesMs,
        mapNamesMs: clock.mapNamesMs,
        packageMs: lap(packageFrom),
        totalMs: lap(clock.from),
      },
      bytes: report.bytes,
      models: described.filter((file) => isModelFile(file.name)).length,
      /* Сколько файлов легло в архив сетевой карты и откуда список: игра игрока или только правило `hei_`. */
      mapArchive: described.filter((file) => isRoadsMapFile(file.name, mapNames)).length,
      mapNamesFromGame: Boolean(mapNames),
      groups: changed.groups,
      parts: [...changed.parts],
      ...(report.failed.length ? { failed: report.failed.slice(0, 8) } : {}),
    },
  };
}
