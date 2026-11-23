import { isMainThread } from "node:worker_threads";
import electron from "electron";

// Нет Электрона в главном потоке (процесс сборки): без переменной считаем «не собрано».
function packagedByEnvironment(mainThread, env) {
  const unset = mainThread && env.ASTRAL_APP_PACKAGED === undefined;
  return unset ? false : env.ASTRAL_APP_PACKAGED === "1";
}

// Электрон знает про сборку и папку resources только в главном потоке главного процесса;
// в потоках и процессах сборки ответ приходит через переменные окружения.
export function appPackaged(options = {}) {
  const { mainThread: askedThread, app: askedApp, env: askedEnv } = options;
  const mainThread = askedThread === undefined ? isMainThread : askedThread;
  const app = askedApp === undefined ? electron?.app : askedApp;
  const env = askedEnv === undefined ? process.env : askedEnv;
  return mainThread && app ? Boolean(app.isPackaged) : packagedByEnvironment(mainThread, env);
}

export function appResourcesPath(options = {}) {
  const { resourcesPath: askedPath, env: askedEnv } = options;
  const resourcesPath = askedPath === undefined ? process.resourcesPath : askedPath;
  const env = askedEnv === undefined ? process.env : askedEnv;
  if (resourcesPath) return resourcesPath;
  return env.ASTRAL_RESOURCES_PATH || undefined;
}

export function workerRuntimeEnvironment(options = {}) {
  const resources = appResourcesPath(options);
  const packaged = appPackaged(options);
  return { ASTRAL_APP_PACKAGED: packaged ? "1" : "0", ...(resources ? { ASTRAL_RESOURCES_PATH: resources } : {}) };
}
