/*
 * Сборка словарей «Дорог» движком (команда `roads-build`, крейт `native/astral-engine/crates/astral-recolor`; 14.11.2026, решение
 * владельца «Astral нужно переписать на Rust»).
 *
 * Прежняя сборка — потоки JS (`roads-build-worker.js`): у «Неоновой ночи» 2442 словаря и 128–138 с на тестовом ПК, после памяти готовых
 * листов — 100 с, но память у каждого потока своя и срабатывает на половине листов. Движок читает словари из архивов игры сам, держит одну
 * память листов на все потоки и пишет готовые файлы; каждый выходит тем же байт в байт, что у JS (`scripts/probe-roads-engine.mjs`).
 *
 * Что остаётся здесь: что работа значит (`roadsEngineLook` контракта), какой лист — дорога (`roadTextureFamily`: семейства листов уходят в
 * запросе, а про незнакомые имена движок отчитывается — их сверяют те же правила) и запасной путь: словарь, который движок не взял
 * (`fallback`), собирает прежний код.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { roadTextureFamily, roadsEngineLook } from "@modovik/climb-contract/recolor/roads";
import { engineBuildThreads, engineScratchDirectory, runEngineCommand } from "./engine-run.js";

const REQUEST_FORMAT = "astral.roads-build";

/** Сборка движком выключена переменной `ASTRAL_ROADS_ENGINE=0` (прежние потоки JS). */
export const roadsEngineEnabled = (env = process.env) => !["0", "off", "false"].includes(String(env.ASTRAL_ROADS_ENGINE ?? "").trim().toLowerCase());

/* Число с плавающей точкой — битами: в JSON оно доехало бы до движка, но не обязательно до последнего бита. */
const bits = (value) => new BigUint64Array(new Float64Array([value]).buffer)[0].toString();

const isBytes = (value) => value instanceof Uint8Array || value instanceof Uint8ClampedArray;

/**
 * Запрос облика для движка: `{ look, sources }`, где `sources` — источники отделки частей (`createRoadsContext().sources`) с байтами
 * RGBA, которые ещё надо положить в файлы. `null` — этот облик движок не считает.
 */
export function roadsEngineLookRequest(project, sources = {}) {
  const resolved = roadsEngineLook(project);
  if (!resolved) return null;
  const parts = {};
  const plates = {};
  for (const [id, surface] of Object.entries(resolved.parts)) {
    parts[id] = {
      stock: surface.stock,
      mode: surface.mode,
      standardK: bits(surface.standardK),
      colour: surface.colour,
      repeats: bits(surface.repeats),
      share: bits(surface.share),
      bright: bits(surface.bright),
    };
    const source = sources[id] || null;
    if (!source) plates[id] = null;
    else if (!isBytes(source.rgba)) return null;
    else if (source.kind === "tile") plates[id] = { kind: "tile", size: source.size, clamp: source.clamp === true, rgba: source.rgba };
    else if (source.kind === "image") plates[id] = { kind: "image", width: source.width, height: source.height, wrap: source.wrap === true, rgba: source.rgba };
    else return null;
  }
  const markings = {
    stock: resolved.markings.stock,
    mask: resolved.markings.mask,
    groups: resolved.markings.groups.map((group) => ({
      stock: group.stock,
      hidden: group.hidden,
      colour: group.colour,
      bright: bits(group.bright),
      wear: bits(group.wear),
    })),
  };
  return { look: { parts, markings }, sources: plates };
}

/** Строки семейств листов для запроса: `[имя, часть, вид, дальний]` по всем листам описи этих файлов. */
export function roadsEngineFamilies(files) {
  const rows = new Map();
  for (const file of files)
    for (const texture of file.textures || []) {
      const name = String(texture[0] || "").toLowerCase();
      if (!name || rows.has(name)) continue;
      const family = roadTextureFamily(name);
      if (family) rows.set(name, [name, family.part, family.kind ?? null, family.lod === true]);
    }
  return [...rows.values()];
}

/**
 * Собрать словари движком. `jobs` — `[{ name, at, output }]` (имя файла, место в игре, куда писать готовый файл), `families` — строки
 * `roadsEngineFamilies`, `request` — ответ `roadsEngineLookRequest`. Ответ — итоги по порядку заданий: `{ name, status, … }`, где `status` —
 * `built` (`bytes`, `sha256`, `textures`, `skipped`, `memo`, `computed`), `unchanged`, `missing` или `fallback` (словарь собирает JS). Словарь, в
 * котором движок встретил незнакомое имя листа, а правила называют его дорогой, тоже отдаётся как `fallback`.
 */
/** Потоков движка на сборку дорог — общее правило тяжёлой сборки (`engineBuildThreads`); `ASTRAL_ROADS_ENGINE_THREADS` — своё число. */
export function roadsEngineThreads({ env = process.env, cores = null } = {}) {
  return engineBuildThreads({ env, cores, envName: "ASTRAL_ROADS_ENGINE_THREADS" });
}

export async function buildRoadsOnEngine({
  executable,
  gameRoot,
  keysDirectory,
  request,
  families,
  jobs,
  threads = 4,
  memoBytes = null,
  onProgress = null,
  onSpawn = null,
  /* `scratchRoot` — корень рабочих папок, назначенный хозяином сборки (`roads-build-host.js`): снятый отменой поток до своего `finally` не доходит, и корень убирает хозяин. */
  scratchRoot = "",
  /* `onTimings({ threads, readMs, parseMs, … })` — время потоков движка по этапам (суммой по потокам): на чём сборка стоит. */
  onTimings = null,
  signal = null,
}) {
  if (!jobs.length) return [];
  const scratch = await engineScratchDirectory("astral-roads-engine-", scratchRoot);
  try {
    const sources = {};
    for (const [id, plate] of Object.entries(request.sources)) {
      if (!plate) {
        sources[id] = null;
        continue;
      }
      const { rgba, ...rest } = plate;
      const file = path.join(scratch, `${id}.rgba`);
      await fs.writeFile(file, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
      sources[id] = { ...rest, file };
    }
    const requestFile = path.join(scratch, `${randomUUID()}.json`);
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        format: REQUEST_FORMAT,
        version: 1,
        gameRoot,
        threads: Math.max(1, Math.floor(threads) || 1),
        ...(Number.isInteger(memoBytes) && memoBytes > 0 ? { memoBytes } : {}),
        look: { ...request.look, sources },
        families,
        jobs,
      }),
    );
    const result = await runEngineCommand(executable, ["roads-build", "--request", requestFile, ...(keysDirectory ? ["--keys", keysDirectory] : [])], {
      onProgress: (progress) => progress.phase === "roads" && onProgress?.({ done: progress.done, total: progress.total }),
      onSpawn,
      signal,
      background: true,
    });
    const files = Array.isArray(result.files) ? result.files : [];
    if (files.length !== jobs.length) throw new Error("Движок сборки дорог ответил не по всем словарям.");
    if (result.timings && typeof result.timings === "object") onTimings?.({ threads: result.threads ?? null, ...result.timings });
    /* Незнакомые движку имена сверяют правила: имя — дорога, значит словарь надо собрать заново прежним кодом. */
    const verdicts = new Map();
    const isRoad = (name) => {
      if (!verdicts.has(name)) verdicts.set(name, roadTextureFamily(name) !== null);
      return verdicts.get(name);
    };
    return files.map((file) => ((file.unknown || []).some(isRoad) ? { name: file.name, status: "fallback", reason: "в словаре есть лист дороги, которого нет в описи" } : file));
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}
