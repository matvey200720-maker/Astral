/*
 * Имена `GROUP_MAP` игры из главного процесса (26.10.2026): чтение идёт в своём потоке (`game-map-names-worker.js`), главный процесс ждёт ответ.
 * Нужно переносу поставленного (`migrateInstalledPlaces`): сборки дорог и растительности уже сидят в своих потоках и читают игру сами.
 * Любой отказ (нет ключей, нет игры, поток упал) — `null`: правило остаётся прежним, `hei_`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { trackedWorker } from "./worker-census.js";
import { archiveKeysDirectory } from "./loader-provisioner.js";

const WORKER_URL = new URL("./game-map-names-worker.js", import.meta.url);

/** `Set<строчные имена>` или `null`. `setId` — `roads` или `vegetation`; `keysDirectory` — папка ключей (по умолчанию — набор ArchiveFix, как у сборок и установки). */
export async function readGameMapNames({ setId, gameRoot, stateDir }, { workerUrl = WORKER_URL, keysDirectory = undefined, log = null, signal = null } = {}) {
  /* Нет игры (нет `update.rpf`) — читать нечего: ни ключей, ни потока. */
  if (!gameRoot || !(await fs.stat(path.join(gameRoot, "update", "update.rpf")).then(() => true, () => false))) return null;
  let keys = keysDirectory;
  if (keys === undefined) keys = await archiveKeysDirectory({ stateDir }).catch(() => "");
  if (!keys) return null;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let worker;
    try {
      worker = trackedWorker("game-map-names", workerUrl, { workerData: { setId, gameRoot, stateDir, keysDirectory: keys } });
    } catch {
      settle(null);
      return;
    }
    worker.on("message", (message) => {
      if (message?.log) log?.(message.log);
      else if (Object.hasOwn(message || {}, "result")) settle(message.result ? new Set(message.result.names) : null);
    });
    worker.on("error", () => settle(null));
    worker.on("exit", () => settle(null));
    signal?.addEventListener("abort", () => {
      settle(null);
      worker.terminate().catch(() => {});
    }, { once: true });
  });
}
