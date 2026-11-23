/*
 * Поток сборки «Дорог» (`roads-build-host.js`): перепись карты, игра, пул
 * потоков перекраски и запись пакета — всё здесь, вне главного процесса.
 * Наружу — ход сборки и готовый пакет (описи, без байтов).
 */

import { keysFromDirectory } from "@modovik/rpf7/node";
import { openBuildPort } from "./build-port.js";
import { followBuildInstallSpeed } from "./build-install-speed.js";
import { roadsImageAssets } from "@modovik/climb-contract/recolor/roads";
import { decodeFinishImages } from "./finish-bake.js";
import { createGameReader } from "./optimization-layers.js";
import { buildRoadsPackage, lazyRoadsPool } from "./recolor-roads.js";
import "./native-block-codec.js";

/* Поток или свой процесс (`build-process.js`) — данные и порт одинаковые. */
const { data: workerData, port: parentPort } = await openBuildPort();
/* Потолок записи и отдых диска — как у установки, со сменой на лету («Быстрая установка» посреди сборки). */
followBuildInstallSpeed(parentPort, workerData);
const { project, stateDir, gameRoot, images, keysDirectory, engine = null, engineScratch = "", container = null, composed = null } = workerData;

try {
  const keys = await keysFromDirectory(keysDirectory || "");
  const assets = [...roadsImageAssets(project).keys()];
  const pictures = assets.length ? await decodeFinishImages(assets, images?.finishes || {}) : new Map();
  const game = createGameReader(gameRoot, keys);
  /* Потоки JS поднимутся по первому словарю, который движок не собрал. */
  /* Контейнер `update.rpf` (GTA 5 RP): потоки поднимутся под работу после плана — без групп, что не влезли (`poolOf`). */
  let pool = container ? null : lazyRoadsPool({ project, images: pictures });
  try {
    const result = await buildRoadsPackage(project, stateDir, {
      game,
      gameRoot,
      keys,
      pool,
      ...(composed?.length ? { composed: new Map(composed) } : {}),
      ...(container ? { container, poolOf: (adjusted) => (pool = lazyRoadsPool({ project: adjusted, images: pictures })) } : {}),
      images: pictures,
      /* Словари собирает движок; номер его процесса уходит наверх — там его снимут вместе со сборкой. */
      engine: engine?.executable
        ? {
            executable: engine.executable,
            keysDirectory: keysDirectory || "",
            onSpawn: (pid) => parentPort.postMessage({ enginePid: pid }),
            /* Рабочие папки движка — в корне хозяина: снятый поток до своей уборки не дойдёт, и корень убирает он. */
            scratch: engineScratch,
          }
        : null,
      onProgress: (progress) => parentPort.postMessage({ progress }),
    });
    parentPort.postMessage({ result });
  } finally {
    await pool?.close().catch(() => {});
    await game.close?.().catch(() => {});
  }
} catch (error) {
  parentPort.postMessage({ error: String(error?.message || error) });
}
