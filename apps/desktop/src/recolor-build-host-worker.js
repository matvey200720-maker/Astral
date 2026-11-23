/*
 * Поток сборки набора мастерской (`recolor-build-host.js`): игра только на
 * чтение, перекраска, дальние планы и запись пакета — здесь. Вызовы
 * нативного хоста (плашки, эмблема) уходят в главный процесс сообщением:
 * у моста окна одна очередь на всё приложение.
 */

import { parentPort, workerData } from "node:worker_threads";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { buildRecolorPackage } from "./recolor-customizer.js";
import { gameMapNames } from "./game-map-names.js";
import { placesMapCandidates } from "./map-name-candidates.js";
import { createGameReader } from "./optimization-layers.js";
import { createShopLightPatcher } from "./shop-lights.js";
import "./native-block-codec.js";

const { setId, input, stateDir, images, held, over, neighbours, gameRoot, keysDirectory, hasCompile, engineScratch } = workerData;

const pending = new Map();
let nextId = 1;
parentPort.on("message", (message) => {
  const reply = message?.compiled;
  if (!reply) return;
  const task = pending.get(reply.id);
  if (!task) return;
  pending.delete(reply.id);
  if (reply.error) task.reject(new Error(reply.error));
  else task.resolve(reply.result);
});
const compile = (command, payload) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    parentPort.postMessage({ compile: { id, command, input: payload } });
  });

try {
  const result = await buildRecolorPackage(setId, input, stateDir, {
    images,
    held: held ? new Map(held) : null,
    over: over ? new Map(over) : null,
    neighbours: neighbours ? new Map(neighbours) : null,
    compile: hasCompile ? compile : null,
    /* Место игры и ключей — рядом с читателем: сборка билбордов движком (`billboards-engine-build.js`, `ASTRAL_BILLBOARDS_ENGINE=1`) читает архивы сама.
       `engineHooks` — как снять эту работу: номер процесса движка и рабочая папка уходят наверх, и отмена, что снимает поток, снимает и их (`recolor-build-host.js`). */
    openGame: async () => ({
      ...createGameReader(gameRoot, await keysFromDirectory(keysDirectory || "")),
      root: gameRoot,
      keysDirectory: keysDirectory || "",
      engineHooks: { scratch: engineScratch || "", onSpawn: (pid) => parentPort.postMessage({ enginePid: pid }) },
    }),
    lights: createShopLightPatcher({ gameRoot, stateDir }),
    /* Имена сетевой карты мест (`game-map-names.js`): читаются здесь же, в потоке сборки; кэш по отпечатку игры. Нет игры или ключей — прежнее правило `hei_`. */
    mapNames: async () => {
      if (!gameRoot) return null;
      const keys = await keysFromDirectory(keysDirectory || "");
      return (await gameMapNames({ gameRoot, keys, candidates: placesMapCandidates(), stateDir }))?.names ?? null;
    },
  });
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: String(error?.message || error) });
}
