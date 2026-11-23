/*
 * Поток сборки растительности (`vegetation-build-host.js`): склады, игра,
 * пул потоков перекраски и запись пакета — всё здесь, вне главного
 * процесса. Наружу — ход сборки и готовый пакет (описи, без байтов).
 */

import { openBuildPort } from "./build-port.js";
import { followBuildInstallSpeed } from "./build-install-speed.js";
import { buildVegetationPackage, countVegetationPlan, openVegetationGame } from "./recolor-vegetation.js";
import { buildVegetationForContainer } from "./vegetation-container-build.js";
import { createVegetationPool, vegetationPoolNote, vegetationPoolPlan } from "./vegetation-build-pool.js";
import "./native-block-codec.js";

/* Поток или свой процесс (`build-process.js`) — данные и порт одинаковые. */
const { data: workerData, port: parentPort } = await openBuildPort();
/* Потолок записи и отдых диска — как у установки, со сменой на лету («Быстрая установка» посреди сборки). */
followBuildInstallSpeed(parentPort, workerData);
const { project, stateDir, gameRoot, composed, stores, keysDirectory, engine = null, engineScratch = "", container = null } = workerData;

/*
 * Нативный хост (типы копий «В разнобой») — через главный процесс: просьба и
 * ответ по номеру. Слушатель — только на время просьбы: со слушателем поток
 * не завершился бы после сборки.
 */
let nextAsk = 1;
const compile = (command, input) =>
  new Promise((resolve, reject) => {
    const id = nextAsk;
    nextAsk += 1;
    const answer = (message) => {
      if (message?.compiled?.id !== id) return;
      parentPort.off("message", answer);
      if (message.compiled.error) reject(new Error(message.compiled.error));
      else resolve(message.compiled.result);
    };
    parentPort.on("message", answer);
    parentPort.postMessage({ compile: { id, command, input } });
  });

try {
  const game = await openVegetationGame({
    gameRoot,
    stateDir,
    keysDirectory,
    improved: project.improved.enabled,
    sandy: project.sandy.enabled,
  });
  /* Размер пула — по ядрам и свободной памяти, один раз перед сборкой; строка о нём уходит в журнал главного процесса. */
  const poolPlan = vegetationPoolPlan();
  parentPort.postMessage({ note: { source: "workers", message: vegetationPoolNote(poolPlan) } });
  const pool = createVegetationPool({ project, sandy: Boolean(game.sandy), size: poolPlan.size });
  try {
    const buildFor = (work) =>
      buildVegetationPackage(work, stateDir, {
        game,
        pool,
        stores,
        composed: new Map(composed),
        compile,
        /* Файлы с листами мода собирает движок; номер его процесса уходит наверх — там его снимут вместе со сборкой. */
        engine: engine?.executable ? { executable: engine.executable, keysDirectory: keysDirectory || "", onSpawn: (pid) => parentPort.postMessage({ enginePid: pid }), scratch: engineScratch } : null,
        onProgress: (progress) => parentPort.postMessage({ progress }),
      });
    /* Контейнер update.rpf (GTA 5 RP): план пород до сборки, сборка выбранных, манифест контейнерной формы (`vegetation-container-build.js`); без `container` — как всегда. */
    const result = container
      ? await buildVegetationForContainer({
          project,
          container,
          countPlan: (work) => countVegetationPlan(work, game, { composed: new Map(composed), cache: null, sizes: true }),
          build: buildFor,
        })
      : await buildFor(project);
    parentPort.postMessage({ result });
  } finally {
    await pool?.close().catch(() => {});
    await game.close?.().catch(() => {});
  }
} catch (error) {
  parentPort.postMessage({ error: String(error?.message || error) });
}
