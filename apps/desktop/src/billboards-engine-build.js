/*
 * Сборка файлов «Билбордов» движком (команда `billboards-build`, крейт `native/astral-engine/crates/astral-recolor`, модуль `billboards`;
 * 16.11.2026, работа «Astral быстрее»).
 *
 * Прежняя сборка — потоки JS (`paintBillboardFile`): у «одной картинки на все щиты» 720 файлов и 1 ГБ, 315 с процессора на тестовом ПК
 * (замер `scripts/probe-sets-build.mjs`): картинки щитов 84 с, укладка в лист 80 с, сжатие 52 с. Движок читает файлы из архивов игры сам,
 * красит листы, пережимает только тронутые блоки и пишет файлы; каждый выходит тем же байт в байт, что у JS
 * (`scripts/probe-billboards-engine.mjs`).
 *
 * Выключено по умолчанию: `ASTRAL_BILLBOARDS_ENGINE=1` включает. Что остаётся здесь: что работа значит (облик каждого щита, пропорция щита,
 * размер места щита на листе — `Math.hypot` у V8 и у движка расходятся в последнем бите, поэтому размер считает JS и шлёт числом) и запасной
 * путь: файл, который движок не взял (`fallback`), и всё, чего он не умеет (рисунок поверх щита, гифка), собирает прежний код.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hexBytes } from "@modovik/climb-contract/recolor";
import { billboardAspect, billboardDrawingHas, billboardLookOf, billboardPixels, billboardSheet, normalizeBillboardsProject } from "@modovik/climb-contract/recolor/billboards";
import { mapLimit } from "@modovik/install-engine/map-limit.js";
import { engineBuildThreads, runEngineCommand } from "./engine-run.js";

const REQUEST_FORMAT = "astral.billboards-build";
/* Файлов, что читаются с диска разом после сборки движком. */
const READ_JOBS = 8;

const ON_WORDS = new Set(["1", "on", "true", "yes"]);

/** Сборка движком включена переменной `ASTRAL_BILLBOARDS_ENGINE=1` (по умолчанию — потоки JS). */
export const billboardsEngineEnabled = (env = process.env) => ON_WORDS.has(String(env.ASTRAL_BILLBOARDS_ENGINE ?? "").trim().toLowerCase());

/** Потоков движка на сборку билбордов — общее правило тяжёлой сборки (`engineBuildThreads`); `ASTRAL_BILLBOARDS_ENGINE_THREADS` — своё число. */
export function billboardsEngineThreads({ env = process.env, cores = null } = {}) {
  return engineBuildThreads({ env, cores, envName: "ASTRAL_BILLBOARDS_ENGINE_THREADS" });
}

/* Число с плавающей точкой — битами: в JSON оно доехало бы до движка, но не обязательно до последнего бита. */
const bits = (value) => new BigUint64Array(new Float64Array([value]).buffer)[0].toString();

/**
 * Облик щита для движка. `null` — этот облик движок не берёт (рисунок поверх щита, гифка, картинки нет в `images`).
 * Правила — как у `paintBillboardOnSheet` и `billboardPicture`: «Как в игре» и своя картинка без картинки меняют только яркость.
 */
function engineLook(look, images, sourceIndex) {
  if (billboardDrawingHas(look.drawing)) return null;
  const brightness = look.brightness;
  if (look.mode === "standard" || (look.mode === "image" && !look.image.asset)) return { paint: "shade", brightness };
  if (look.mode === "colour") return { paint: "colour", colour: hexBytes(look.colour), brightness };
  if (look.mode === "gradient") return { paint: "gradient", from: hexBytes(look.colour), to: hexBytes(look.colour2), down: look.direction === "down", brightness };
  if (look.mode === "image") {
    if (look.image.animation) return null;
    const image = images.get(look.image.asset);
    if (!image?.rgba || !(image.width > 0) || !(image.height > 0)) return null;
    return {
      paint: "image",
      source: sourceIndex(look.image.asset, image),
      fit: look.fit,
      background: hexBytes(look.background),
      zoom: look.zoom || 100,
      panX: look.panX || 0,
      panY: look.panY || 0,
      brightness,
    };
  }
  return null;
}

/**
 * Запрос работы для движка: `{ looks, sources, jobs }`, где `sources` — картинки RGBA, которые ещё надо положить в файлы, а `jobs` — по файлу плана
 * (`billboardPlan(project).files`). `null` — работу движок не берёт целиком (у какого-то щита рисунок или гифка).
 */
export function billboardsEngineRequest(project, plan, images) {
  const work = normalizeBillboardsProject(project);
  const looks = [];
  const lookByKey = new Map();
  const sources = [];
  const sourceByAsset = new Map();
  const sourceIndex = (asset, image) => {
    if (!sourceByAsset.has(asset)) {
      sourceByAsset.set(asset, sources.length);
      sources.push({ rgba: image.rgba, width: image.width, height: image.height });
    }
    return sourceByAsset.get(asset);
  };
  const lookOf = (boardId) => {
    const resolved = engineLook(billboardLookOf(work, boardId), images, sourceIndex);
    if (!resolved) return -1;
    const key = JSON.stringify(resolved);
    if (!lookByKey.has(key)) {
      lookByKey.set(key, looks.length);
      looks.push(resolved);
    }
    return lookByKey.get(key);
  };
  const jobs = [];
  for (const item of plan.files) {
    const sheets = [];
    for (const { sheet, width, height, items } of item.sheets) {
      const known = billboardSheet(sheet.id);
      if (!known) return null;
      const placed = [];
      for (const { board, entry } of items) {
        const look = lookOf(board.id);
        if (look < 0) return null;
        placed.push({
          look,
          aspect: bits(billboardAspect(board)),
          clip: entry.clip.map(bits),
          map: entry.map.map((corner) => corner.map(bits)),
          size: billboardPixels(entry, width, height),
        });
      }
      sheets.push({ name: known.name, width, height, items: placed });
    }
    jobs.push({ name: item.file, at: item.at, sheets });
  }
  return { looks, sources, jobs };
}

const isBytes = (value) => value instanceof Uint8Array || value instanceof Uint8ClampedArray;

/**
 * Собрать файлы щитов движком. `plan` — `billboardPlan(project)`, `images` — `Map` ключ → `{ rgba, width, height }`. Ответ — по файлу плана:
 * `{ status: "built", bytes, textures, sheets, missing }`, `{ status: "unchanged", missing }`, `{ status: "missing" }` или `{ status: "fallback", reason }`
 * (файл собирает прежний код). `bytes` — `Buffer` готового файла. `null` — работу движок не берёт целиком.
 */
export async function buildBillboardsOnEngine({
  executable,
  gameRoot,
  keysDirectory = "",
  project,
  plan,
  images,
  threads = 4,
  onProgress = null,
  /* `onSpawn(pid)` — номер процесса движка, чтобы кто снимает сборку целиком, снял и его; `onSpawn(0)` — процесс вышел (`runEngineCommand`): на освободившемся номере мог поселиться чужой. */
  onSpawn = null,
  /* `scratch` — рабочая папка, назначенная хозяином сборки (`recolor-build-host.js`): отменённая сборка до своего `finally` не доходит, и хозяин убирает её сам. Без неё — своя во временной папке. */
  scratch: scratchDir = "",
  /* `onTimings({ threads, readMs, parseMs, … })` — время потоков движка по этапам (суммой по потокам): на чём сборка стоит. */
  onTimings = null,
  signal = null,
}) {
  if (!plan.files.length) return [];
  const request = billboardsEngineRequest(project, plan, images);
  if (!request) return null;
  const scratch = scratchDir ? await fs.mkdir(scratchDir, { recursive: true }).then(() => scratchDir) : await fs.mkdtemp(path.join(os.tmpdir(), "astral-billboards-engine-"));
  try {
    const sources = [];
    for (const [index, source] of request.sources.entries()) {
      if (!isBytes(source.rgba) || source.rgba.byteLength !== source.width * source.height * 4) return null;
      const file = path.join(scratch, `source-${index}.rgba`);
      await fs.writeFile(file, Buffer.from(source.rgba.buffer, source.rgba.byteOffset, source.rgba.byteLength));
      sources.push({ file, width: source.width, height: source.height });
    }
    const out = path.join(scratch, "out");
    const jobs = request.jobs.map((job, index) => ({ ...job, output: path.join(out, `${index}-${job.name}`) }));
    const requestFile = path.join(scratch, `${randomUUID()}.json`);
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        format: REQUEST_FORMAT,
        version: 1,
        gameRoot,
        threads: Math.max(1, Math.floor(threads) || 1),
        sources,
        looks: request.looks,
        jobs,
      }),
    );
    const result = await runEngineCommand(executable, ["billboards-build", "--request", requestFile, ...(keysDirectory ? ["--keys", keysDirectory] : [])], {
      onProgress: (progress) => progress.phase === "billboards" && onProgress?.({ done: progress.done, total: progress.total }),
      onSpawn,
      signal,
      background: true,
    });
    const files = Array.isArray(result.files) ? result.files : [];
    if (files.length !== jobs.length) throw new Error("Движок сборки билбордов ответил не по всем файлам.");
    if (result.timings && typeof result.timings === "object") onTimings?.({ threads: result.threads ?? null, ...result.timings });
    /* Готовые файлы — в память: дальше они идут тем же путём, что и собранные потоками JS (`buildBillboardFiles`). */
    return await mapLimit(files, READ_JOBS, async (file, index) => {
      if (file.status !== "built") return file;
      const bytes = await fs.readFile(jobs[index].output);
      if (bytes.length !== file.bytes) throw new Error(`Движок сборки билбордов: файл ${file.name} на диске не совпал с ответом.`);
      return { ...file, bytes };
    });
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}
