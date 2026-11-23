/*
 * Плитки тумана «Воды» — движком (`water-build`, крейт `native/astral-engine/crates/astral-recolor`; 14.11.2026, работа «Astral быстрее»,
 * решение владельца «Astral нужно переписать на Rust»).
 *
 * Плитки — 96 % сборки воды: 944 словаря BC7 и DXT1 с полной цепочкой mip, 71 с процессора на JS (замер тестового ПК: разбор BC7 — 36 %,
 * цвет точки — 27 %, сжатие BC7 — 26 %), в пуле из четырёх потоков — около двадцати секунд. Движок красит их своими потоками и отдаёт те
 * же файлы байт в байт (`scripts/probe-water-engine.mjs` сверяет каждую плитку настоящей игры, `tests/water-engine-parity.test.js` —
 * плитки-образцы).
 *
 * Что работа значит, решает приложение: облик едет готовыми числами (`waterFogEngineLook` в контракте) — полоса цвета каждой группы уже
 * байтами, числа с плавающей точкой — битами `f64`. Плитку, которую движок дословно не повторяет (незнакомый формат листа, спорная
 * раскладка, отказ разбора), он отдаёт со статусом `fallback`: её красит прежний код (`water-tiles.js`). Реки, квады и подводный таймцикл
 * остаются у приложения — это два процента работы.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { engineBuildThreads, runEngineCommand } from "./engine-run.js";

const REQUEST_FORMAT = "astral.water-build";
/* Метка архива, из которого читаются плитки: чистая основа update.rpf из кэша Astral или живой архив игры. */
const ARCHIVE_LABEL = "base";

/** Движок воды выключается `ASTRAL_WATER_ENGINE=0`: плитки красит прежний код. */
export const waterEngineEnabled = () => process.env.ASTRAL_WATER_ENGINE !== "0";

/** Потоков движка на плитки воды — общее правило тяжёлой сборки; `ASTRAL_WATER_ENGINE_THREADS` — своё число. */
export const waterEngineThreads = ({ env = process.env, cores = null } = {}) => engineBuildThreads({ env, cores, envName: "ASTRAL_WATER_ENGINE_THREADS" });

/* Число `f64` битами (десятичная строка `u64`): в JSON оно доезжает до движка тем же до последнего бита. */
const bitsView = new DataView(new ArrayBuffer(8));
const bits = (value) => {
  bitsView.setFloat64(0, Number(value), true);
  return bitsView.getBigUint64(0, true).toString();
};

/** Облик (`waterFogEngineLook`) в виде запроса движка: числа с плавающей точкой — битами. */
export function waterEngineFogRequest(look) {
  const group = (item) => ({ tint: item.tint, line: item.line, direction: item.direction, width: bits(item.width), table: item.table });
  return {
    bounds: look.bounds.map(bits),
    depthMetres: bits(look.depthMetres),
    lumaDeep: bits(look.lumaDeep),
    lumaShallow: bits(look.lumaShallow),
    minGreen: look.minGreen,
    sea: group(look.sea),
    inland: group(look.inland),
    lakes: look.lakes.map((lake) => lake.map(bits)),
  };
}

/**
 * Покрасить плитки движком. `archive` — файл update.rpf (основа или живой), `look` — `waterFogEngineLook`, `jobs` —
 * `[{ name, entry, rect } | { name, file, rect }]`: запись в архиве (`entry`) или файл на диске (`file`, стенды и тесты без игры).
 *
 * Итог — по одному на задание, в том же порядке: `{ status: "built", bytes }`, `{ status: "unchanged" }`, `{ status: "missing" }` или
 * `{ status: "fallback", reason }` — такую плитку красит прежний код. Отказ движка целиком — исключение.
 */
export async function buildWaterTilesOnEngine({
  executable,
  gameRoot,
  keysDirectory = "",
  archive = "",
  look,
  jobs,
  threads = undefined,
  onProgress = null,
  onSpawn = null,
  /* `onTimings({ threads, readMs, parseMs, … })` — время потоков движка по этапам (суммой по потокам). */
  onTimings = null,
  signal = null,
}) {
  if (!jobs.length) return [];
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "astral-water-engine-"));
  try {
    const outputs = jobs.map((job, index) => path.join(scratch, "out", `${index}.ytd`));
    const requestFile = path.join(scratch, `${randomUUID()}.json`);
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        format: REQUEST_FORMAT,
        version: 1,
        gameRoot,
        threads: Math.max(1, Math.floor(threads ?? waterEngineThreads()) || 1),
        ...(archive ? { archives: { [ARCHIVE_LABEL]: archive } } : {}),
        fog: waterEngineFogRequest(look),
        jobs: jobs.map((job, index) => ({
          name: job.name,
          ...(job.file ? { file: job.file } : { at: `${ARCHIVE_LABEL}:${job.entry}` }),
          rect: [bits(job.rect.west), bits(job.rect.north), bits(job.rect.size)],
          output: outputs[index],
        })),
      }),
    );
    const result = await runEngineCommand(executable, ["water-build", "--request", requestFile, ...(keysDirectory ? ["--keys", keysDirectory] : [])], {
      onProgress: (progress) => progress.phase === "water" && onProgress?.({ done: progress.done, total: progress.total }),
      onSpawn,
      signal,
      background: true,
    });
    const files = Array.isArray(result.files) ? result.files : [];
    if (files.length !== jobs.length) throw new Error("Движок сборки воды ответил не по всем плиткам.");
    if (result.timings && typeof result.timings === "object") onTimings?.({ threads: result.threads ?? null, ...result.timings });
    return await Promise.all(
      files.map(async (file, index) => {
        if (file.status !== "built") return file.status === "unchanged" || file.status === "missing" ? { status: file.status } : { status: "fallback", reason: String(file.reason || "") };
        const bytes = await fs.readFile(outputs[index]).catch(() => null);
        /* Файл не дочитался или не той длины, что назвал движок, — плитку красит прежний код. */
        return bytes && bytes.length === file.bytes ? { status: "built", bytes, sha256: file.sha256 } : { status: "fallback", reason: "готовый файл плитки не прочитан" };
      }),
    );
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}
