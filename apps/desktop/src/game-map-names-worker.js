/*
 * Поток чтения имён `GROUP_MAP` игры (`game-map-names-host.js`): проход по сотне пакетов (около шести секунд без кэша) идёт вне главного процесса.
 * Наружу — `{ result: { names, cached, ms, packs } }` или `{ result: null }` (игру прочитать не вышло — вызывающий остаётся на правиле `hei_`).
 */

import { parentPort, workerData } from "node:worker_threads";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { gameMapNames } from "./game-map-names.js";
import { mapCandidatesOf } from "./map-name-candidates.js";

const { setId, gameRoot, stateDir, keysDirectory } = workerData;

try {
  const candidates = mapCandidatesOf(setId);
  const keys = await keysFromDirectory(keysDirectory || "");
  const result = candidates
    ? await gameMapNames({ gameRoot, keys, candidates, stateDir, log: (entry) => parentPort.postMessage({ log: entry }) })
    : null;
  parentPort.postMessage({ result: result ? { names: [...result.names], cached: result.cached, ms: result.ms, packs: result.packs } : null });
} catch (error) {
  parentPort.postMessage({ result: null, error: String(error?.message || error) });
}
