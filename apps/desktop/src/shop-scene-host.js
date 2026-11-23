import * as census from "./worker-census.js";
import * as buildHost from "./recolor-build-host.js";
import * as runtimePaths from "./runtime-paths.js";

const POOL = "shop-scene";
const OUT_OF_MEMORY = "ERR_WORKER_OUT_OF_MEMORY";

const settled = (rejected, value) => ({ rejected, value });

// Что значит каждое событие потока: { rejected, value } завершает вызов, null — ждём дальше.
function reactToMessage(message) {
  const failure = message?.error;
  if (failure) return settled(true, new Error(failure));
  const result = message?.result;
  if (!result) return null;
  if (result.buffer) {
    return settled(false, { bytes: new Uint8Array(result.buffer), report: result.report });
  }
  return settled(false, { reason: result.reason });
}

function reactToError(error) {
  if (error?.code === OUT_OF_MEMORY) return settled(false, { outOfMemory: true });
  return settled(true, error);
}

function reactToExit(code) {
  return settled(true, new Error(`Сборка помещения остановилась (код ${code}).`));
}

// События подписываются в этом порядке.
const REACTIONS = [
  ["message", reactToMessage],
  ["error", reactToError],
  ["exit", reactToExit],
];

function launchOptions(task, heapLimitMb) {
  const workerData = Object.fromEntries([
    ["id", task.id],
    ["pieces", task.pieces || null],
    ["gameRoot", task.gameRoot],
    ["keys", task.keys || ""],
  ]);
  const env = Object.assign({}, process.env, buildHost.resourceEnvironment(), runtimePaths.workerRuntimeEnvironment());
  return { workerData, env, resourceLimits: { maxOldGenerationSizeMb: heapLimitMb } };
}

export function buildShopSceneOffThread(task, options = {}) {
  const workerUrl = options.workerUrl === undefined ? new URL("./shop-scene-worker.js", import.meta.url) : options.workerUrl;
  const heapLimitMb = options.heapLimitMb === undefined ? 1536 : options.heapLimitMb;
  return new Promise((resolve, reject) => {
    const worker = census.trackedWorker(POOL, workerUrl, launchOptions(task, heapLimitMb));
    let concluded = false;
    const conclude = (verdict) => {
      concluded = true;
      (verdict.rejected ? reject : resolve)(verdict.value);
      worker.terminate().catch(() => {});
    };
    for (const [event, react] of REACTIONS) {
      worker.on(event, (payload) => {
        if (concluded) return;
        const verdict = react(payload);
        if (verdict) conclude(verdict);
      });
    }
  });
}
