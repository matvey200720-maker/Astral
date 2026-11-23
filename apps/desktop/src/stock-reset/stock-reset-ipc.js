/*
 * Каналы «Сбросить GTA до стандартной» (Настройки → Игра).
 *
 *   STOCK_RESET_SCAN      — сверка папки с описью штатной игры, в потоке;
 *   STOCK_RESET_PROGRESS  — где сверка сейчас (окно спрашивает, пока ждёт);
 *   STOCK_RESET_APPLY     — лишнее в карантин и проверка файлов магазином;
 *   STOCK_RESET_VERIFY    — открыть проверку магазина ещё раз;
 *   STOCK_QUARANTINE_LIST / STOCK_QUARANTINE_RESTORE — «Вернуть убранные файлы».
 *
 * Свои моды Astral снимает до этого обычным «Вернуть GTA V без модов»
 * (очередь «Загрузок», `RESET_TARGET`): у него есть копии «до Astral». Пока
 * они стоят, перенос отказывает — окно сначала зовёт восстановление.
 *
 * Что уносить, решает главный процесс по своей последней сверке, а не окно:
 * окно присылает только то, что человек снял с отметки (`skip`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectProfile } from "@modovik/install-engine";
import { trackedWorker } from "../worker-census.js";
import { runStockScan } from "./stock-scan.js";
import { listQuarantine, moveToQuarantine, restoreFromQuarantine } from "./stock-quarantine.js";
import { isVerifyUrl, platformVerifyAction } from "./platform-verify.js";

const WORKER_URL = new URL("./stock-scan-worker.js", import.meta.url);
const GAME_RUNNING = "Закройте GTA V: пока игра запущена, её файлы заняты.";

/** Сверка в потоке; поток не поднялся — здесь же (медленнее для окна, ответ тот же). */
export function scanInWorker(input, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = trackedWorker("stock-scan", WORKER_URL, { workerData: input });
    } catch {
      runStockScan(input, { onProgress }).then(resolve, reject);
      return;
    }
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
      void worker.terminate().catch(() => {});
    };
    worker.on("message", (message) => {
      if (message?.progress) onProgress(message.progress);
      else if (message && "error" in message) settle(reject, new Error(message.error));
      else if (message && "result" in message) settle(resolve, message.result);
    });
    worker.on("error", (error) => settle(reject, error));
    worker.on("exit", (code) => settle(reject, new Error(`Сверка остановилась (код ${code}).`)));
  });
}

/* Файлы, в которых сейчас лежат моды Astral: их сверять с описью рано, их вернёт сам Astral. */
export function astralFootprint(target) {
  const paths = new Set();
  for (const item of target?.installed || []) for (const relative of item?.resources || []) paths.add(relative);
  for (const [relative, resource] of Object.entries(target?.resources || {}))
    if (resource?.layers?.length) paths.add(relative);
  return {
    mods: (target?.installed || []).length,
    paths: [...paths],
    vanillaGuard: Boolean(target?.vanillaGuard && target.vanillaGuard.phase !== "restored"),
  };
}

const rootKey = (gameRoot) => createHash("sha1").update(path.resolve(gameRoot).toLowerCase()).digest("hex").slice(0, 16);

/* Что уходит в окно: без памяти хешей и полного списка единиц переноса. */
function publicScan(scan, extra = {}) {
  if (!scan) return null;
  const { cache: _cache, allExtras: _all, ...rest } = scan;
  return { ...rest, ...extra };
}

export function registerStockResetIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  shell,
  findGame,
  gameProcessRunning,
  installOptions,
  userDataDir,
  resourcesPath = () => process.resourcesPath,
  manifestOrigin = () => process.env.ASTRAL_STOCK_MANIFEST_ORIGIN || process.env.ASTRAL_CLOUD_ORIGIN || null,
  runScan = scanInWorker,
  readProfile = inspectProfile,
  verifyAction = platformVerifyAction,
}) {
  const jobs = new Map();
  const job = (targetId) => {
    if (!jobs.has(targetId)) jobs.set(targetId, { progress: null, running: null, last: null });
    return jobs.get(targetId);
  };
  const dataDir = () => userDataDir();
  const quarantineRoot = () => path.join(dataDir(), "stock-quarantine");
  const manifestCache = () => path.join(dataDir(), "stock-manifests");

  async function targetRecord(targetId) {
    const { stateDir } = await installOptions();
    const profile = await readProfile({ stateDir });
    return profile?.targets?.[targetId] || null;
  }

  async function readHashCache(gameRoot) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(manifestCache(), `hash-${rootKey(gameRoot)}.json`), "utf8"));
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  }

  async function writeHashCache(gameRoot, cache) {
    await fs.mkdir(manifestCache(), { recursive: true });
    await fs.writeFile(path.join(manifestCache(), `hash-${rootKey(gameRoot)}.json`), JSON.stringify(cache));
  }

  async function scan(targetId, mode) {
    const state = job(targetId);
    if (state.running) return state.running;
    state.running = (async () => {
      const game = await findGame(targetId);
      const footprint = astralFootprint(await targetRecord(targetId));
      state.progress = { phase: "walk" };
      const result = await runScan(
        {
          gameRoot: game.path,
          edition: game.edition,
          store: game.store,
          executable: game.executable,
          mode: mode === "full" ? "full" : "quick",
          astralPaths: footprint.paths,
          cache: await readHashCache(game.path),
          sources: {
            localDirs: [process.env.ASTRAL_STOCK_MANIFESTS, resourcesPath() && path.join(resourcesPath(), "stock-manifests")],
            cacheDir: manifestCache(),
            origin: manifestOrigin(),
          },
        },
        (progress) => {
          state.progress = progress;
        },
      );
      await writeHashCache(game.path, result.cache).catch(() => {});
      const verify = await verifyAction(game);
      state.last = { ...result, footprint, verify, targetId };
      return state.last;
    })().finally(() => {
      state.running = null;
      state.progress = null;
    });
    return state.running;
  }

  async function quarantineSummary(gameRoot) {
    const sessions = await listQuarantine({ root: quarantineRoot(), gameRoot });
    return {
      sessions: sessions.length,
      files: sessions.reduce((sum, item) => sum + item.files, 0),
      bytes: sessions.reduce((sum, item) => sum + item.bytes, 0),
    };
  }

  async function view(scanResult) {
    return publicScan(scanResult, {
      astral: { mods: scanResult.footprint.mods, files: scanResult.totals.astral, vanillaGuard: scanResult.footprint.vanillaGuard },
      verify: {
        ...scanResult.verify,
        needed: Boolean(scanResult.totals.modified || scanResult.totals.missing || scanResult.manifest.status !== "matched"),
      },
      quarantine: await quarantineSummary(scanResult.gameRoot),
    });
  }

  async function openVerify(action) {
    if (action.kind !== "url" || !isVerifyUrl(action.url)) return false;
    try {
      await shell.openExternal(action.url);
      return true;
    } catch {
      return false;
    }
  }

  handleIpc(IPC.STOCK_RESET_SCAN, (event, input) =>
    trusted(event, async () => {
      const { targetId, mode } = safeInput(input);
      return view(await scan(String(targetId || ""), mode));
    }),
  );

  handleIpc(IPC.STOCK_RESET_PROGRESS, (event, input) =>
    trusted(event, async () => {
      const { targetId } = safeInput(input);
      return jobs.get(String(targetId || ""))?.progress || null;
    }),
  );

  handleIpc(IPC.STOCK_RESET_APPLY, (event, input) =>
    trusted(event, async () => {
      const { targetId: rawId, skip = [] } = safeInput(input);
      const targetId = String(rawId || "");
      const game = await findGame(targetId);
      if (await gameProcessRunning(game)) throw new Error(GAME_RUNNING);
      const footprint = astralFootprint(await targetRecord(targetId));
      if (footprint.vanillaGuard) throw new Error("Сейчас идёт игра без модов: дождитесь её конца.");
      if (footprint.mods) throw new Error("Сначала Astral снимает свои моды: «Вернуть GTA V без модов».");
      /* Свежая сверка: «Вернуть без модов» только что вернул в игру то, что Astral откладывал. */
      const before = await scan(targetId, job(targetId).last?.mode);
      const skipped = new Set((Array.isArray(skip) ? skip : []).map((item) => String(item).toLowerCase()));
      const units = before.allExtras.filter((unit) => !skipped.has(unit.path.toLowerCase()));
      const moved = await moveToQuarantine({ root: quarantineRoot(), gameRoot: game.path, targetId, units });
      const after = await scan(targetId, before.mode);
      const needed = Boolean(after.totals.modified || after.totals.missing || after.manifest.status !== "matched");
      const opened = needed ? await openVerify(after.verify) : false;
      return {
        moved: moved.moved.length,
        movedFiles: units.filter((unit) => moved.moved.includes(unit.path)).reduce((sum, unit) => sum + unit.files, 0),
        movedBytes: units.filter((unit) => moved.moved.includes(unit.path)).reduce((sum, unit) => sum + unit.bytes, 0),
        failed: moved.failed,
        sessionId: moved.sessionId,
        verify: { ...after.verify, needed, opened },
        after: await view(after),
      };
    }),
  );

  handleIpc(IPC.STOCK_RESET_VERIFY, (event, input) =>
    trusted(event, async () => {
      const { targetId } = safeInput(input);
      const action = await verifyAction(await findGame(String(targetId || "")));
      return { ...action, opened: await openVerify(action) };
    }),
  );

  handleIpc(IPC.STOCK_QUARANTINE_LIST, (event, input) =>
    trusted(event, async () => {
      const { targetId } = safeInput(input);
      const game = targetId ? await findGame(String(targetId)).catch(() => null) : null;
      return listQuarantine({ root: quarantineRoot(), gameRoot: game?.path || null });
    }),
  );

  handleIpc(IPC.STOCK_QUARANTINE_RESTORE, (event, input) =>
    trusted(event, async () => {
      const { targetId, sessionId } = safeInput(input);
      const game = await findGame(String(targetId || ""));
      if (await gameProcessRunning(game)) throw new Error(GAME_RUNNING);
      const sessions = sessionId
        ? [String(sessionId)]
        : (await listQuarantine({ root: quarantineRoot(), gameRoot: game.path })).map((item) => item.id);
      const total = { returned: 0, conflicts: 0, failed: 0, remaining: 0 };
      for (const id of sessions) {
        const result = await restoreFromQuarantine({ root: quarantineRoot(), sessionId: id, gameRoot: game.path });
        total.returned += result.returned.length;
        total.conflicts += result.conflicts.length;
        total.failed += result.failed.length;
        total.remaining += result.remaining;
      }
      return total;
    }),
  );
}
