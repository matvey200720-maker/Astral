import path from "node:path";
import { createDesktopEngineCrashGuard } from "./engine-crash-guard.js";
import { configureEngineHttp, engineAssetsHeaders, setEngineCrashGuard } from "./native-engine.js";

const LOOPBACK_FILTER = { urls: ["http://127.0.0.1:*/*"] };
const SHELL_HEADER = "X-Astral-Shell";
const FALLBACK_WEB_URL = "http://127.0.0.1:5173";
const ASSETS_DIR_NAME = "engine-assets";

export function installEngineCrashGuard(app) {
  setEngineCrashGuard(createDesktopEngineCrashGuard(app));
}

// Адрес из переменной среды: пустое значение — запасной адрес, иначе без одной завершающей черты.
function webUrlFromEnv(env) {
  const value = env.MODOVIK_WEB_URL;
  return value ? value.replace(/\/$/, "") : FALLBACK_WEB_URL;
}

// Адрес окна для канала данных: параметр как есть, иначе переменная среды.
const windowAddress = (localWebUrl, env) => localWebUrl || webUrlFromEnv(env);

// Источник заголовков: по адресу запроса отдаёт объект для добавления или пустое значение.
function shellKeySource({ shellToken, localWebUrl }) {
  return (url) => {
    if (!shellToken || !localWebUrl) {
      return null;
    }
    return url.startsWith(`${localWebUrl}/`) ? { [SHELL_HEADER]: shellToken } : null;
  };
}

function engineTokenSource() {
  return (url) => engineAssetsHeaders(url);
}

// Слушатель заголовков: источники применяются по порядку, поэтому токен движка перекрывает ключ окна.
function headerListener(shell) {
  const sources = [shellKeySource(shell), engineTokenSource()];
  return (details, callback) => {
    const requestHeaders = sources.reduce((headers, source) => {
      const extra = source(details.url);
      return extra ? Object.assign(headers, extra) : headers;
    }, details.requestHeaders);
    callback({ requestHeaders });
  };
}

// Настройка канала данных движка. Любой сбой поглощается, результат тогда undefined.
async function connectEngineChannel(origin, installOptions) {
  // Первое ожидание отдаёт управление: installOptions зовётся уже после возврата из wireWindowRequests.
  await undefined;
  try {
    const { stateDir } = await installOptions();
    const assetsDir = path.join(path.dirname(stateDir), ASSETS_DIR_NAME);
    return await configureEngineHttp({ origin, assetsDir });
  } catch {
    return undefined;
  }
}

export function wireWindowRequests({
  session,
  shellToken = "",
  localWebUrl = "",
  installOptions,
  env = process.env,
}) {
  const webRequest = session.defaultSession.webRequest;
  webRequest.onBeforeSendHeaders(LOOPBACK_FILTER, headerListener({ shellToken, localWebUrl }));
  return connectEngineChannel(windowAddress(localWebUrl, env), installOptions);
}
