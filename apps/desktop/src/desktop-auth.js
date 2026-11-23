import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REMEMBERED_CATALOG_FILE,
  CATALOG_V2_DICTIONARIES,
  CLOSED_CLOUD_CATALOG,
  FRESH_FOR_MS,
  createCatalogAccess,
  createCloudCatalog,
} from "./cloud-catalog.js";
import { heavyWork } from "./heavy-work.js";
import { UPDATE_DRIFT_KIND, setUpdateDriftReporter } from "./update-drift-report.js";
import { parseDownloadGrantV1Response } from "@modovik/contracts/download-grant-v1";
import { fetchNewsV1 } from "@modovik/contracts/news-v1";
import {
  fetchShowcaseV1,
  postShowcaseEventsV1,
} from "@modovik/contracts/showcase-v1";
import { validWireReport } from "@modovik/contracts/app-errors";
import {
  ERROR_LOG_LIMITS,
  registerErrorReportingIpc,
  startErrorReporting,
} from "./app-errors.js";
import { appLog, registerAppLogIpc } from "./app-log.js";
import { registerGameCrashIpc } from "./game-crash/ipc.js";
import {
  CREDENTIAL_FILE,
  createCredentialVault,
  describeError,
} from "./credential-vault.js";
import { defaultLogSources } from "./app-log-sources.js";
import { startRunState } from "./run-state.js";
import { createCatalogFetch } from "./catalog-fetch.js";
import { createGrantReuse } from "./grant-reuse.js";
import { watchEngineRetries, watchHostFailures } from "./native-engine.js";
import { releaseVersionFor } from "./updates/display-version.js";
import { openUrl } from "./elevation.js";
import { BROWSER_UNSAFE_PORTS, isBrowserUnsafePort, listenOnSafePort } from "./loopback-port.js";
import { CALLBACK_PAGE_HEADERS, callbackLanguage, oauthCallbackPage } from "./oauth-callback-page.js";

const b64url = (value) => Buffer.from(value).toString("base64url");
const sha256 = (value) => createHash("sha256").update(value).digest();
const desktopUserAgent = "AstralDesktop/1";
const ERROR_LOG_MAX_BYTES = ERROR_LOG_LIMITS.gzipBytes;

export function createElectronDesktopAuth({
  app,
  safeStorage,
  shell,
  localAgentOrigin = "",
  onCatalogUpdate = null,
}) {
  const origin = resolveDesktopCloudOrigin({ app });
  const auth = createDesktopAuth({
    origin,
    localAgentOrigin: isLoopbackHTTPOrigin(origin) ? localAgentOrigin : "",
    mediaOrigin: process.env.ASTRAL_MEDIA_ORIGIN || "",
    userData: app.getPath("userData"),
    catalogFile: path.join(app.getPath("userData"), REMEMBERED_CATALOG_FILE),
    onCatalogUpdate,
    safeStorage,
    openExternal: (target) => openUrl(shell, target),
    /* Вход пишет в «Логи» (Т-147): что на диске на старте и чем кончилась
       попытка поднять сессию. */
    log: (entry) => appLog.record(entry),
  });
  /* Номер выпуска беты (0.9.0-beta.N), а не 1.0.1 из package.json — в журнале и в отчётах. */
  const shownVersion = releaseVersionFor(app.getPath("exe"), app.getVersion());
  /* Отчёты об ошибках приложения (Т-130) ходят каналом облака. */
  auth.errors = startErrorReporting({
    userData: app.getPath("userData"),
    appVersion: shownVersion,
    send: (events, clientId) => auth.reportErrors({ clientId, events }),
    /* Журнал к отчёту вошедшего — тот же текст, что «Скачать для тикета». */
    uploadLog: (input) => auth.uploadErrorLog(input),
    buildLog: async () => (await appLog.current?.buildExport())?.text || "",
  });
  /* Расхождение update.rpf с основой (`update-drift-report.js`): отчёт без журнала, один на запуск. */
  setUpdateDriftReporter((info) => auth.errors.capture(info, { kind: UPDATE_DRIFT_KIND, source: "main" }));
  startDesktopAppLog({ userData: app.getPath("userData"), appVersion: shownVersion });
  /* Прошлый запуск оборвался без закрытия — это видно в журнале (14.10.2026). */
  startRunState({ app, log: appLog, version: shownVersion });
  /* Что лежит на диске до первого обращения окна: если на втором запуске
     просят войти снова, причина уже в журнале. */
  appLog.record({
    level: "info",
    source: "session",
    message: keyStorageNote({ userData: app.getPath("userData"), safeStorage }),
  });
  /* Канал к облаку греется, пока поднимается окно: DNS, TCP, TLS и часы облака (`warmCloud`). */
  void auth.warmCloud().catch(() => {});
  void auth.diagnoseSession().catch((error) =>
    appLog.record({
      level: "warn",
      source: "session",
      message: `сессия: проверка при старте не удалась — ${describeError(error)}`,
    }),
  );
  return auth;
}

/*
 * Хранилище ключей одной строкой. `safeStorage` на Windows шифрует учётку
 * ключом, который Chromium держит в `Local State` папки данных: потерялся
 * этот файл (или оборвалась его запись при первом запуске) — ключ создан
 * заново, и прежняя учётка не расшифровывается. Папка данных названа здесь
 * только именем: «Astral» и «Astral Developer» — разные учётки.
 */
export function keyStorageNote({
  userData,
  safeStorage,
  platform = process.platform,
}) {
  let available = "неизвестно";
  try {
    available = safeStorage.isEncryptionAvailable() ? "доступно" : "НЕДОСТУПНО";
  } catch (error) {
    available = `ошибка: ${describeError(error)}`;
  }
  let localState = "";
  if (platform === "win32") {
    try {
      const state = JSON.parse(
        readFileSync(path.join(userData, "Local State"), "utf8"),
      );
      localState = `, Local State: ${state?.os_crypt?.encrypted_key ? "ключ шифрования есть" : "ключа шифрования нет"}`;
    } catch (error) {
      localState = `, Local State: ${error?.code === "ENOENT" ? "файла нет" : "не читается"}`;
    }
  }
  return `сессия: хранилище ключей ${available}${localState}; папка данных «${path.basename(userData)}»`;
}

/* Журнал приложения (Т-153): падения процесса, срывы хоста, чужие журналы-источники. */
function startDesktopAppLog({ userData, appVersion }) {
  const log = appLog.start({ userData, appVersion });
  log.install(process);
  watchHostFailures(({ command, message, tail }) =>
    log.record({
      level: "error",
      source: "native-host",
      message: `${command || "native-host"}: ${message}`,
      detail: Array.isArray(tail) ? tail.slice(-40).join("\n") : "",
    }),
  );
  /* Вызов движка повторился (`archivefix-retry.js`): предупреждением, ошибкой станет только отказ после последней попытки. */
  watchEngineRetries(({ command, attempt, of, delayMs, message }) =>
    log.record({
      level: "warn",
      source: "native-host",
      message: `${command}: ${message} — попытка ${attempt} из ${of} не удалась, повтор через ${(delayMs / 1000).toFixed(1).replace(".", ",")} с (файл мог держать антивирус или другая программа)`,
    }),
  );
  for (const source of defaultLogSources()) log.registerSource(source);
  log.record({ level: "info", source: "app", message: `Astral ${appVersion} запущен` });
  return log;
}

export function isLocalDesktopBuild({
  app,
  resourcesPath = process.resourcesPath,
}) {
  if (!app.isPackaged) return false;
  try {
    readLocalDesktopConfig(resourcesPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function localDeveloperModeRequested({
  app,
  args = process.argv,
  resourcesPath = process.resourcesPath,
}) {
  return (
    Array.isArray(args) &&
    args.includes("--local-developer") &&
    isLocalDesktopBuild({ app, resourcesPath })
  );
}

export function resolveDesktopCloudOrigin({
  app,
  resourcesPath = process.resourcesPath,
}) {
  if (process.env.ASTRAL_CLOUD_ORIGIN) {
    return process.env.ASTRAL_CLOUD_ORIGIN;
  }
  if (!app.isPackaged) return "http://127.0.0.1:8080";
  try {
    return readLocalDesktopConfig(resourcesPath).cloudOrigin;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return "https://astral.com";
}

function readLocalDesktopConfig(resourcesPath) {
  const localConfig = JSON.parse(
    readFileSync(path.join(resourcesPath, "astral-local.json"), "utf8"),
  );
  if (
    Object.keys(localConfig).sort().join(",") !== "cloudOrigin,mode" ||
    localConfig.mode !== "local-development" ||
    !isLoopbackHTTPOrigin(localConfig.cloudOrigin)
  ) {
    throw new Error("Invalid local desktop configuration.");
  }
  return {
    mode: "local-development",
    cloudOrigin: new URL(localConfig.cloudOrigin).origin,
  };
}

function isLoopbackHTTPOrigin(raw) {
  try {
    const target = new URL(raw);
    const loopback = new Set(["127.0.0.1", "[::1]", "localhost"]);
    return (
      target.protocol === "http:" &&
      loopback.has(target.hostname) &&
      !target.username &&
      !target.password &&
      target.pathname === "/" &&
      !target.search &&
      !target.hash
    );
  } catch {
    return false;
  }
}

export function registerDesktopAuthIPC({ IPC, handleIpc, trusted, auth, dialog = null }) {
  handleIpc(IPC.CLOUD_LOGIN, (event, mode) =>
    trusted(event, () => auth.login(mode)),
  );
  handleIpc(IPC.CLOUD_LOGIN_CANCEL, (event) =>
    trusted(event, () => auth.cancelLogin()),
  );
  handleIpc(IPC.CLOUD_LOGIN_LINK, (event) =>
    trusted(event, () => auth.loginLink()),
  );
  handleIpc(IPC.CLOUD_SESSION, (event) => trusted(event, () => auth.session()));
  handleIpc(IPC.CLOUD_CATALOG, (event) => trusted(event, () => auth.catalog()));
  handleIpc(IPC.CLOUD_NEWS, (event) => trusted(event, () => auth.news()));
  /* Реклама выключена, пока не включили явно (Т-165): витрину не спрашиваем,
     показы не шлём. */
  const adsEnabled = () => process.env.ASTRAL_ADS_ENABLED === "1";
  handleIpc(IPC.CLOUD_SHOWCASE, (event, place) =>
    trusted(event, () => (adsEnabled() ? auth.showcase(place) : [])),
  );
  handleIpc(IPC.CLOUD_SHOWCASE_EVENTS, (event, events) =>
    trusted(event, () => (adsEnabled() ? auth.showcaseEvents(events) : null)),
  );
  handleIpc(IPC.CLOUD_MOD_LINK, (event, modID) =>
    trusted(event, () => auth.modLink(modID)),
  );
  handleIpc(IPC.CLOUD_DOWNLOAD_GRANT, (event, modID) =>
    trusted(event, () => auth.downloadGrant(modID)),
  );
  handleIpc(IPC.CLOUD_CATALOG_RATING_GET, (event, modID) =>
    trusted(event, () => auth.rating(modID)),
  );
  handleIpc(IPC.CLOUD_CATALOG_RATING_SET, (event, input) =>
    trusted(event, () => auth.setRating(input)),
  );
  handleIpc(IPC.CLOUD_LIBRARY_FAVORITES, (event) =>
    trusted(event, () => auth.libraryFavorites()),
  );
  handleIpc(IPC.CLOUD_LIBRARY_SET_FAVORITE, (event, input) =>
    trusted(event, () => auth.setLibraryFavorite(input)),
  );
  handleIpc(IPC.CLOUD_LIBRARY_BUILDS, (event) =>
    trusted(event, () => auth.libraryBuilds()),
  );
  handleIpc(IPC.CLOUD_LIBRARY_CREATE_BUILD, (event, input) =>
    trusted(event, () => auth.createLibraryBuild(input)),
  );
  handleIpc(IPC.CLOUD_LIBRARY_UPDATE_BUILD, (event, input) =>
    trusted(event, () => auth.updateLibraryBuild(input)),
  );
  handleIpc(IPC.CLOUD_LIBRARY_DELETE_BUILD, (event, input) =>
    trusted(event, () => auth.deleteLibraryBuild(input)),
  );
  handleIpc(IPC.CLOUD_WORK_CODE_SHARE, (event, input) =>
    trusted(event, () => auth.shareWorkCode(input)),
  );
  handleIpc(IPC.CLOUD_WORK_CODE_OPEN, (event, input) =>
    trusted(event, () => auth.openSharedWorkCode(input)),
  );
  handleIpc(IPC.CLOUD_TELEMETRY, (event, input) =>
    trusted(event, () => auth.telemetry(input)),
  );
  handleIpc(IPC.CLOUD_LOGOUT, (event) => trusted(event, () => auth.logout()));
  registerAppLogIpc({
    IPC,
    handleIpc,
    trusted,
    showSaveDialog: dialog ? (options) => dialog.showSaveDialog(options) : undefined,
  });
  registerGameCrashIpc({
    IPC,
    handleIpc,
    trusted,
    showSaveDialog: dialog ? (options) => dialog.showSaveDialog(options) : undefined,
  });
  if (auth.errors)
    registerErrorReportingIpc({
      IPC,
      handleIpc,
      trusted,
      reporting: auth.errors,
    });
}

export function cancelPendingLoginWhenWindowReturns(window, auth) {
  let blurredDuringLogin = false;
  const handleBlur = () => {
    if (auth.isLoginPending()) blurredDuringLogin = true;
  };
  const handleFocus = () => {
    if (!blurredDuringLogin) return;
    blurredDuringLogin = false;
    auth.cancelLogin();
  };
  const cleanup = () => {
    window.removeListener("blur", handleBlur);
    window.removeListener("focus", handleFocus);
  };
  window.on("blur", handleBlur);
  window.on("focus", handleFocus);
  window.once("closed", cleanup);
  return cleanup;
}

/*
 * `catalogFile` — где помнить последний проверенный каталог (пусто — нигде),
 * `onCatalogUpdate(catalog)` — каталог, который окно должно увидеть без
 * запроса: первые страницы и свежий после запомненного (`cloud-catalog.js`).
 */
export function createDesktopAuth({
  origin,
  localAgentOrigin = "",
  mediaOrigin = "",
  userData,
  catalogFile = "",
  onCatalogUpdate = null,
  safeStorage,
  openExternal,
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = CLOUD_TIMEOUT_MS,
  /* Строки журнала «Логи» (`{ level, message, detail }`): что с входом на
     старте и почему он кончился (Т-147). */
  log = () => {},
  /* Файловая система и паузы повтора записи — подставляются в проверках
     сбоев диска. */
  fsImpl,
  writeRetryDelays,
  wait,
  browserOpenWaitMs = LOGIN_BROWSER_OPEN_WAIT_MS,
  /* Сколько запомненный каталог без метки ждёт ответа о доступе, прежде чем окно его увидит (30.10.2026). */
  openCheckBudgetMs = OPEN_CHECK_BUDGET_MS,
  /* Сколько запомненный каталог считается свежим (`cloud-catalog.js`); 0 — всегда спрашивать сеть. */
  catalogFreshForMs = FRESH_FOR_MS,
}) {
  const cloudOrigin = validateOrigin(origin);
  /* Каждый ответ облака сверяет часы: следующая подпись DPoP уйдёт по ним. */
  const cloudFetch = async (target, options, ceilingMs = timeoutMs) => {
    const began = performance.now();
    let response;
    try {
      response = await fetchWithin(fetchImpl, target, options, ceilingMs);
    } catch (error) {
      noteRequest(options, target, began, error);
      throw error;
    }
    noteRequest(options, target, began, null, response.status);
    learnServerClock(response);
    return response;
  };
  /* Медленный или сорвавшийся запрос — строкой в «Логи» со временем (30.10.2026): жалоба «каталог не загрузился» приходила без единой цифры, и разбирать её было нечем. Быстрые
     запросы журнал не засоряют. */
  const noteRequest = (options, target, began, error, status = 0) => {
    const took = performance.now() - began;
    if (!error && took < SLOW_REQUEST_MS) return;
    const method = String(options?.method || "GET").toUpperCase();
    const route = new URL(target).pathname;
    if (error) note("warn", `облако: ${method} ${route} — не вышло за ${(took / 1000).toFixed(1)} с`, error.detail || describeError(error));
    else note("info", `облако: ${method} ${route} — ответ ${status} за ${(took / 1000).toFixed(1)} с`);
  };
  let pendingLogin = null;
  let pendingLoginCancel = null;
  /* Ссылка входа, пока вход ждёт браузер: окно даёт открыть её ещё раз или скопировать. */
  let pendingLoginLink = "";
  /* «Вход подтверждён облаком» пишется в журнал один раз за запуск. */
  let announcedOnline = false;
  /* Учётка на диске: чтение, запись и стирание — одним местом и по одному
     (`credential-vault.js`). */
  const vault = createCredentialVault({
    file: path.join(userData, CREDENTIAL_FILE),
    safeStorage,
    inspect: invalidStoredState,
    log: (entry) => log({ ...entry, source: "session" }),
    ...(fsImpl && { fsImpl }),
    ...(writeRetryDelays && { retryDelays: writeRetryDelays }),
    ...(wait && { wait }),
  });
  const note = (level, message, detail = "") =>
    log({ level, source: "session", message, ...(detail && { detail }) });

  async function login(mode = "login") {
    if (mode !== "login" && mode !== "register")
      throw new Error("Invalid desktop sign-in mode.");
    if (pendingLogin) return pendingLogin;
    pendingLogin = performLogin(mode).finally(() => {
      pendingLogin = null;
    });
    return pendingLogin;
  }

  async function performLogin(mode) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const privateJwk = privateKey.export({ format: "jwk" });
    const publicJwk = publicKey.export({ format: "jwk" });
    const deviceJkt = jwkThumbprint(publicJwk);
    const verifier = b64url(randomBytes(64));
    const challenge = b64url(sha256(verifier));
    const state = b64url(randomBytes(32));
    const callback = await createLoopbackCallback(state);
    const cancelCallback = () => callback.cancel();
    pendingLoginCancel = cancelCallback;
    try {
      const authorize = new URL("/oauth2/authorize", cloudOrigin);
      authorize.search = new URLSearchParams({
        client_id: "astral-desktop",
        response_type: "code",
        code_challenge_method: "S256",
        code_challenge: challenge,
        device_jkt: deviceJkt,
        redirect_uri: callback.redirectUri,
        state,
        screen_hint: mode,
      }).toString();
      /* Стадии входа пишутся в «Логи»: если вход повис, видно, на какой
         (24.10.2026: у владельца «бесконечная загрузка», а в журнале не было
         ни строки между нажатием и итогом). */
      note("info", `сессия: вход (${mode}) — открываем браузер`);
      pendingLoginLink = authorize.toString();
      /* Открытие браузера ждём не дольше `browserOpenWaitMs` и не дольше самого входа
         (25.10.2026): у тестеров альфы оно не возвращалось, вход висел на нём, а «Отменить
         вход» и возврат фокуса закрывали только ожидание кода — каждое следующее «Войти»
         получало тот же повисший вход. На сервере за полдня не было ни одного
         /oauth2/authorize. Теперь вход идёт к ожиданию кода, ссылку окно открывает ещё раз
         или копирует (`loginLink`). */
      const opening = Promise.resolve().then(() => openExternal(pendingLoginLink));
      let openTimer;
      let opened;
      try {
        opened = await Promise.race([
          opening.then(() => "opened"),
          callback.result.then(
            () => "returned",
            () => "settled",
          ),
          new Promise((resolve) => {
            openTimer = setTimeout(() => resolve("slow"), browserOpenWaitMs);
          }),
        ]);
      } catch (error) {
        note("warn", "сессия: вход — браузер не открылся", describeError(error));
        throw error;
      } finally {
        clearTimeout(openTimer);
      }
      if (opened !== "opened")
        opening.catch((error) => note("warn", "сессия: вход — браузер не открылся", describeError(error)));
      if (opened === "slow") {
        note(
          "warn",
          `сессия: вход — браузер не ответил за ${Math.round(browserOpenWaitMs / 1000)} с; ждём возврат, ссылку можно открыть ещё раз или скопировать`,
        );
      } else if (opened !== "settled") {
        note("info", "сессия: вход — браузер открыт, ждём возврат на 127.0.0.1");
      }
      let code;
      try {
        code = await callback.result;
      } catch (error) {
        note("info", `сессия: вход — ${describeLoginWait(error)}`);
        throw error;
      }
      note("info", "сессия: вход — браузер вернул код, меняем его на токены");
      const tokenTarget = new URL("/oauth2/token", cloudOrigin).toString();
      /* Подпись строится заново на каждый запрос: повтор после сверки часов
         уходит с верным временем. Код при отказе по подписи не сгорает —
         облако проверяет подпись раньше кода. Потолок по времени тот же, что у
         прочих запросов к облаку: без него молчащая сеть держала бы вход
         вечно, пока окно показывает «Продолжите вход в браузере». */
      const exchange = () =>
        fetchWithin(
          fetchImpl,
          tokenTarget,
          {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": desktopUserAgent,
              DPoP: createProof(privateKey, publicJwk, "POST", tokenTarget),
            },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              client_id: "astral-desktop",
              code,
              code_verifier: verifier,
              redirect_uri: callback.redirectUri,
            }),
          },
          timeoutMs === CLOUD_TIMEOUT_MS ? LOGIN_EXCHANGE_TIMEOUT_MS : timeoutMs,
        );
      let response;
      try {
        response = await withServerClock(exchange, () =>
          note("info", "сессия: часы компьютера сбиты — вход повторён по часам облака", describeClockSkew()),
        );
      } catch (error) {
        note("warn", "сессия: вход — обмен кода не дошёл до облака", error?.detail || describeError(error));
        throw error;
      }
      note("info", `сессия: вход — облако ответило на обмен кода: HTTP ${response.status}`);
      let tokens;
      try {
        tokens = await parseTokens(response);
      } catch (error) {
        if (error.kind) throw error;
        note("warn", "сессия: облако не приняло вход", [error.status && `HTTP ${error.status}`, error.oauth, describeClockSkew()].filter(Boolean).join(", "));
        /* Окну — понятная причина, а не текст протокола (переводится словарём окна). */
        throw new Error(Math.abs(serverClockOffsetMs) >= CLOCK_SKEW_MS ? LOGIN_CLOCK_TEXT : LOGIN_REFUSED_TEXT, { cause: error });
      }
      const stored = {
        privateJwk,
        publicJwk,
        ...tokens,
        accessExpiresAt: now() + tokens.expires_in * 1000,
      };
      /* Не записалось — вход не состоялся, и человек узнаёт об этом сразу, а
         не на следующем запуске. */
      await vault.exclusive(() => vault.store(stored));
      note("info", "сессия: вход выполнен — учётка записана на диск");
      /* Новый аккаунт — каталог его глазами (команде видно больше). */
      reloadCatalog("вход в аккаунт");
      return session();
    } finally {
      if (pendingLoginCancel === cancelCallback) {
        pendingLoginCancel = null;
        pendingLoginLink = "";
      }
      callback.close();
    }
  }

  function isLoginPending() {
    return Boolean(pendingLogin);
  }

  /** Ссылка входа, пока вход ждёт браузер; пусто — ждать нечего. */
  function loginLink() {
    return pendingLoginCancel ? pendingLoginLink : "";
  }

  function cancelLogin() {
    return Boolean(pendingLoginCancel?.());
  }

  async function refresh(stored) {
    const privateKey = importPrivateKey(stored.privateJwk);
    const tokenTarget = new URL("/oauth2/token", cloudOrigin).toString();
    /* Отказ по подписи из-за сбитых часов refresh-токен не тратит (облако
       проверяет подпись раньше токена): повтор по часам облака безопасен, а
       без него учётку стёр бы `400 invalid_grant`. */
    const response = await withServerClock(
      () =>
        cloudFetch(tokenTarget, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": desktopUserAgent,
            DPoP: createProof(privateKey, stored.publicJwk, "POST", tokenTarget),
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: "astral-desktop",
            refresh_token: stored.refresh_token,
          }),
        }),
      () => note("info", "сессия: часы компьютера сбиты — обновление повторено по часам облака", describeClockSkew()),
    );
    /* 5xx и 429 — про связь, а не про вход: учётку не трогают. */
    if (transientStatus(response.status)) {
      await response.body?.cancel?.().catch(() => {});
      throw cloudUnreachable();
    }
    let tokens;
    try {
      tokens = await parseTokens(response);
    } catch (error) {
      if (error.kind) throw error;
      /* Отказ — это `400 invalid_grant`: refresh-токен отозван, истёк или
         предъявлен повторно. Всё остальное, что не выдало новую пару (403 от
         прокси, страница входа гостиничного Wi-Fi, `invalid_request` из-за
         неверно настроенного сервера), — не приговор входу: стереть учётку по
         ним значило бы выйти из аккаунта из-за чужой ошибки. */
      if (error.status === 400 && error.oauth === "invalid_grant")
        throw cloudRejected(error);
      throw cloudUnclear(error);
    }
    const next = {
      ...stored,
      ...tokens,
      accessExpiresAt: now() + tokens.expires_in * 1000,
    };
    /* Пара принята облаком, прежней больше нет: сначала в память, диск
       повторяется и не стирает пару. */
    await vault.rotate(next);
    note("info", "сессия: токены обновлены (refresh-токен сменился)");
    return next;
  }

  /*
   * Учётка для запроса: из памяти, а если access кончается — обновлённая.
   *
   * Чтение и обновление — одна операция в очереди хранилища. Раньше второй
   * вызов на старте мог прочесть учётку до того, как первый её обновил, и
   * отправить в облако refresh-токен, который уже сменился: облако считает это
   * кражей и закрывает вход целиком.
   */
  /* Когда и чем кончилось последнее обновление, до которого облако не дотянулось: ждущие в очереди хранилища получают тот же отказ сразу, а не повторяют его каждый со своим потолком. */
  let refreshFailure = null;
  function currentState() {
    return vault.exclusive(async () => {
      let stored = await vault.load();
      if (!stored) return null;
      if (stored.accessExpiresAt <= now() + 30_000) {
        if (refreshFailure && performance.now() - refreshFailure.at < REFRESH_RETRY_GAP_MS) throw refreshFailure.error;
        try {
          stored = await refresh(stored);
          refreshFailure = null;
        } catch (error) {
          if (error.kind === "unreachable") refreshFailure = { at: performance.now(), error };
          /* Стирают только учётку, от которой облако отказалось. Раньше её
             стирал любой сбой обновления, и Astral, открытый без сети,
             выходил из аккаунта насовсем: access живёт пять минут, так что
             обновление идёт почти на каждом старте. */
          if (error.kind === "unreachable") {
            note(
              "info",
              `сессия: облако не ответило при обновлении — вход сохранён${error.detail ? ` (${error.detail})` : ""}`,
            );
            throw error;
          }
          await vault.forgetNow(
            `облако отказало при обновлении (${error.detail || describeError(error.cause || error)})`,
          );
          throw error;
        }
      }
      return stored;
    });
  }

  /*
   * Запрос с access. 401 — ещё не приговор: access мог кончиться по часам
   * облака (у компьютера время уходит), прокси мог срезать заголовок. Первый
   * 401 — повод обновить учётку и повторить запрос один раз; стирает её
   * только отказ самого обновления (`400 invalid_grant`).
   */
  async function authorized(send, statuses = [401]) {
    let stored = await currentState();
    if (!stored) return { stored: null, response: null };
    let response = await send(stored);
    if (!statuses.includes(response.status)) return { stored, response };
    await response.body?.cancel?.().catch(() => {});
    await vault.expireAccess(stored.access_token);
    stored = await currentState();
    if (!stored) return { stored: null, response: null };
    response = await send(stored);
    return { stored, response };
  }

  /*
   * Сессия окна.
   *
   *   { user, connection: "online" }   облако узнало человека;
   *   { user, connection: "offline" }  облако не ответило, а учётка жива —
   *                                    окно работает с запомненным профилем
   *                                    и переподключается само;
   *   { user: null, connection: "offline", signedIn: true }
   *                                    то же, но профиль ещё не запомнен
   *                                    (учётка из версии до этой);
   *   { user: null, ended: true }      облако отказало, учётка стёрта —
   *                                    нужен новый вход;
   *   { user: null }                   никто не входил.
   *
   * Отказ и молчание различаются здесь, в главном процессе: окну приходит
   * ответ, а не исключение, потому что через IPC у ошибки доезжает только
   * текст.
   */
  async function session() {
    let stored;
    try {
      stored = await currentState();
    } catch (error) {
      return sessionAfterFailure(error);
    }
    if (!stored) return { user: null };
    const remembered = rememberedUser(stored.user);
    try {
      const target = new URL("/api/v1/app/me", cloudOrigin).toString();
      const { stored: current, response } = await authorized(
        (state) =>
          cloudFetch(target, {
            method: "GET",
            redirect: "error",
            headers: {
              Authorization: `DPoP ${state.access_token}`,
              DPoP: createProof(
                importPrivateKey(state.privateJwk),
                state.publicJwk,
                "GET",
                target,
                state.access_token,
              ),
              "User-Agent": desktopUserAgent,
            },
          }),
        [401, 403],
      );
      /* Учётку стёрли, пока шёл запрос (выход). */
      if (!current) return { user: null, ended: true };
      if (response.status === 401 || response.status === 403) {
        /* Облако не приняло и только что выданный access. */
        await response.body?.cancel?.().catch(() => {});
        await vault.forget(
          `облако не приняло свежий access (HTTP ${response.status})`,
          { onlyIfAccess: current.access_token },
        );
        return { user: null, ended: true };
      }
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        throw cloudUnreachable();
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        throw cloudUnreachable(error);
      }
      const profile = storedProfile(payload?.user);
      if (!profile) throw cloudUnreachable();
      if (!sameProfile(current.user, profile)) {
        /* В самую свежую учётку: пока шёл запрос, её могли обновить. */
        await vault.exclusive(() =>
          vault.update((latest) => ({ ...latest, user: profile })),
        );
      }
      if (!announcedOnline) {
        announcedOnline = true;
        note("info", "сессия: вход подтверждён облаком");
        /* Страницы каталога ушли раньше, чем поднялся вход, — гостю сервер
           отдал пустой каталог; спрашиваем ещё раз уже с входом. */
        if (catalogFetch.anonymous()) reloadCatalog("вход поднялся позже каталога");
      }
      return { user: normalizeUser(profile), connection: "online" };
    } catch (error) {
      return sessionAfterFailure(error, remembered);
    }
  }

  /*
   * Чем кончилась попытка поднять вход, если окну нельзя отдать профиль:
   *  • облако не ответило — вход жив, окно работает запомненным профилем;
   *  • учётку прочесть сейчас нельзя — файл оставлен, вход «есть, профиля
   *    ещё нет», окно переподключается само;
   *  • всё прочее (облако отказало, запись повреждена) — вход закончился.
   */
  function sessionAfterFailure(error, remembered = null) {
    const known = remembered || rememberedUser(vault.snapshot()?.user);
    if (error?.kind === "unreachable") {
      return known
        ? { user: known, connection: "offline" }
        : { user: null, connection: "offline", signedIn: true };
    }
    if (error?.kind === "unreadable") {
      note(
        "warn",
        `сессия: ошибка чтения — ${describeError(error.cause || error)}`,
        "Файл учётки оставлен, чтение повторится при следующем обращении окна.",
      );
      return known
        ? { user: known, connection: "offline" }
        : { user: null, connection: "offline", signedIn: true };
    }
    if (error?.kind !== "broken" && error?.kind !== "rejected") {
      note(
        "error",
        `сессия: неожиданный сбой — ${describeError(error)}`,
        String(error?.stack || "").slice(0, 1500),
      );
    }
    return { user: null, ended: true };
  }

  /*
   * Журнал старта: что лежит на диске. Ничего не меняет и не стирает — это
   * вопрос «что было бы», а не попытка войти. Нужна, чтобы по «Логи» было
   * видно, почему на втором запуске окно просит войти снова.
   */
  async function diagnoseSession() {
    const view = await vault.diagnose();
    if (view.status === "none") {
      note(
        "info",
        "сессия: не найдена — файла учётки нет (вход не выполнялся или учётка стёрта)",
      );
    } else if (view.status === "found") {
      const { state } = view;
      const minutes = Math.round((state.accessExpiresAt - now()) / 60_000);
      note(
        "info",
        `сессия: найдена — access ${minutes > 0 ? `ещё ${minutes} мин` : "истёк, обновится при входе в окно"}, refresh до ${String(state.refresh_expires_at).slice(0, 10)}, профиль запомнен: ${rememberedUser(state.user) ? "да" : "нет"}`,
      );
    } else if (view.status === "unreadable") {
      note(
        "warn",
        `сессия: ошибка чтения — ${view.reason}`,
        "Файл учётки оставлен, чтение повторится при следующем обращении окна.",
      );
    } else {
      note(
        "warn",
        `сессия: ошибка чтения — ${view.reason}`,
        "Учётка негодна и будет стёрта при первом обращении окна: понадобится новый вход.",
      );
    }
    return view.status;
  }

  /*
   * Каждый каталог, ушедший окну, — ответом или событием — несёт `revision`,
   * номер по порядку в этом процессе. Ответ на запрос и событие приходят
   * окну в любом порядке, и окно не кладёт старый каталог поверх нового.
   * Номер берётся, когда облачная часть готова, до локальной добавки.
   */
  let catalogRevision = 0;
  /* Страницы каталога — с входом (каталог только команде, бета 14.10): `catalog-fetch.js`. */
  const catalogFetch = createCatalogFetch({
    fetchImpl,
    readState: () => currentState(),
    authorized,
    proof: (state, htu) =>
      createProof(importPrivateKey(state.privateJwk), state.publicJwk, "GET", htu, state.access_token),
    userAgent: desktopUserAgent,
  });
  function reloadCatalog(reason) {
    catalogFetch.resetAnonymous();
    catalogAccess.forget();
    note("info", `каталог: перекачиваю — ${reason}`);
    cloudCatalogs
      .reload()
      .then((cloud) =>
        note("info", `каталог: ${cloud?.mods?.length ?? 0} модов, ${catalogFetch.anonymous() ? "часть страниц без входа" : "с входом"}`),
      )
      .catch((error) => note("warn", `каталог: не перекачался — ${describeError(error)}`));
  }
  /* Кто вошёл — из памяти или с диска, не вставая в очередь входа (она стоит на обновлении токена, а оно ждёт сеть до потолка). Пусто — никто или файл сейчас не читается. */
  async function signedInAccountId() {
    try {
      const stored = await vault.peek();
      return stored && typeof stored.user?.id === "string" ? stored.user.id : "";
    } catch {
      return "";
    }
  }
  const cloudCatalogs = createCloudCatalog({
    origin: cloudOrigin,
    mediaOrigin,
    dictionaries: CATALOG_V2_DICTIONARIES,
    fetchImpl: catalogFetch,
    file: catalogFile,
    /* Метка в запомненном файле — только у каталога, скачанного с входом: страницы без входа (гость) пусты и под аккаунт не пишутся. */
    accountOf: () => (catalogFetch.anonymous() ? "" : signedInAccountId()),
    freshForMs: catalogFreshForMs,
    log: (level, message) => note(level, message),
    /* Запомненный каталог разбирает поток пула: главный процесс на старте не ждёт файл. */
    offThread: (input) => heavyWork.run("remembered-catalog", input),
    onUpdate:
      onCatalogUpdate &&
      ((cloud, { partial }) => {
        const revision = ++catalogRevision;
        withLocalCatalog(cloud)
          .then((merged) =>
            onCatalogUpdate({
              ...merged,
              revision,
              ...(partial && { partial: true }),
            }),
          )
          .catch(() => {});
      }),
  });

  /* «Новости Astral» главной: публичный список облака (T-129). Сеть легла —
     ошибка, и окно остаётся со своими записями. */
  const news = () =>
    fetchNewsV1({ origin: cloudOrigin, fetchImpl: cloudFetch });

  /* Свои места показа (T-134): список места и пачка показов и кликов. */
  const showcase = (place) =>
    fetchShowcaseV1({ origin: cloudOrigin, place, fetchImpl: cloudFetch });
  const showcaseEvents = (events) =>
    postShowcaseEventsV1({
      origin: cloudOrigin,
      events,
      fetchImpl: cloudFetch,
    });

  /* Каталог — только команде (admin/alpha): тестеру облачные моды не качаем и запомненный каталог не показываем. */
  const catalogAccess = createCatalogAccess({
    request: async () => {
      const target = new URL("/api/v1/app/catalog/access", cloudOrigin).toString();
      const { stored, response } = await authorized((state) =>
        cloudFetch(target, {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          headers: {
            Accept: "application/json",
            Authorization: `DPoP ${state.access_token}`,
            DPoP: createProof(
              importPrivateKey(state.privateJwk),
              state.publicJwk,
              "GET",
              target,
              state.access_token,
            ),
            "User-Agent": desktopUserAgent,
          },
        }),
      );
      if (!stored) return null;
      if (response.status !== 200) {
        await response.body?.cancel?.().catch(() => {});
        return { status: response.status, body: null };
      }
      const text = await response.text();
      return { status: 200, body: text.length <= 1024 ? JSON.parse(text) : null };
    },
  });

  /*
   * Каталог окну на старте. Запомненный лежит на диске, и показать его сети не нужно — а раньше выдача ждала обновление токена (access живёт пять минут) и вопрос «открыт ли
   * каталог», у каждого потолок 8 с, и очередь входа повторяла проваленное обновление за каждого ждущего: на плохой сети окно полминуты видело «Каталог не загрузился»
   * и пустой экран при каталоге на диске (30.10.2026). Теперь запомненный каталог того же аккаунта уходит сразу, а открытость и свежий проверяются фоном: каталог закрыт —
   * окно получает пустой каталог событием, свежий — событием, как и после запомненного прежде.
   */
  async function catalog() {
    const accountId = await signedInAccountId();
    const quick = accountId ? await cloudCatalogs.remembered(accountId).catch(() => null) : null;
    if (quick) {
      verifyCatalogInBackground();
      const revision = ++catalogRevision;
      return { ...(await withLocalCatalog(quick)), revision };
    }
    return catalogChecked();
  }

  /* Открыт ли каталог аккаунту (вопрос к облаку) и свежий каталог — после того, как окно уже получило запомненный. */
  function verifyCatalogInBackground() {
    catalogAccess
      .isOpen()
      .then(async (open) => {
        if (open) {
          await cloudCatalogs.load();
          return;
        }
        const revision = ++catalogRevision;
        onCatalogUpdate?.({ ...(await withLocalCatalog({ ...CLOSED_CLOUD_CATALOG })), revision });
      })
      .catch((error) => note("warn", `каталог: проверка в фоне не удалась — ${describeError(error)}`));
  }

  /*
   * Каталог без метки аккаунта (до 30.10.2026 файл метки не нёс) и вопрос «открыт ли он»: раньше вопрос шёл первым, и каталог ждал за ним — обновление токена и сам вопрос по
   * потолку 8 с каждый. Теперь они идут вместе, а запомненному без метки вопрос даёт короткий бюджет (`OPEN_CHECK_BUDGET_MS`): ответил «закрыт» — окно получает пустой каталог,
   * не ответил — окно видит запомненный, а ответ придёт и закроет его событием (`verifyOpenInBackground`). Нет запомненного — каталог ждёт сети, как и раньше.
   */
  async function catalogChecked() {
    const opening = catalogAccess.isOpen();
    const loading = cloudCatalogs.load();
    /* Исход загрузки разбирается ниже; пока ждём вопрос, необработанного отказа не бывает. */
    loading.catch(() => {});
    const unlabelled = await cloudCatalogs.rememberedUnlabelled().catch(() => null);
    let open;
    if (unlabelled) {
      const budget = new Promise((resolve) => setTimeout(() => resolve(undefined), openCheckBudgetMs));
      open = await Promise.race([opening, budget]);
    } else {
      open = await opening;
    }
    if (open === undefined) {
      verifyOpenInBackground(opening);
      const revision = ++catalogRevision;
      return { ...(await withLocalCatalog(unlabelled)), revision };
    }
    if (!open) {
      const revision = ++catalogRevision;
      return { ...(await withLocalCatalog({ ...CLOSED_CLOUD_CATALOG })), revision };
    }
    let cloud;
    try {
      cloud = await loading;
    } catch (error) {
      if (!localAgentOrigin) throw error;
      cloud = {
        source: "astral-local-only",
        platforms: [],
        categories: [],
        mods: [],
      };
    }
    const revision = ++catalogRevision;
    return { ...(await withLocalCatalog(cloud)), revision };
  }

  /* Вопрос «открыт ли каталог» не успел за бюджет: окно уже видит запомненный, а ответ придёт позже — закрыт, и окно получает пустой каталог событием. */
  function verifyOpenInBackground(opening) {
    opening
      .then(async (open) => {
        if (open) return;
        const revision = ++catalogRevision;
        onCatalogUpdate?.({ ...(await withLocalCatalog({ ...CLOSED_CLOUD_CATALOG })), revision });
      })
      .catch((error) => note("warn", `каталог: проверка в фоне не удалась — ${describeError(error)}`));
  }

  /* Локальная сборка: к облачному каталогу — тестовые моды локального API. */
  async function withLocalCatalog(cloud) {
    if (!localAgentOrigin) return cloud;
    let local;
    try {
      local = await fetchLocalTestCatalog(localAgentOrigin, fetchImpl);
    } catch (error) {
      /* Локальный API перезапускается — облачный каталог от этого не пуст. */
      if (cloud.source === "astral-local-only") throw error;
      return cloud;
    }
    return {
      ...cloud,
      platforms: [...(cloud.platforms || []), ...(local.platforms || [])],
      categories: [...(cloud.categories || []), ...(local.categories || [])],
      mods: [...local.mods, ...cloud.mods],
    };
  }

  /* Выданные ссылки на пакеты — повторно, пока годны (`grant-reuse.js`): сервер выдаёт 30 в минуту на устройство. */
  const grantReuse = createGrantReuse({ now });

  async function downloadGrant(modID) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        modID || "",
      )
    ) {
      throw new Error("Invalid Astral catalog identifier.");
    }
    return grantReuse.get(modID, () => requestDownloadGrant(modID));
  }

  async function requestDownloadGrant(modID) {
    const target = new URL(
      `/api/v1/app/catalog/${modID}/download-grant`,
      cloudOrigin,
    ).toString();
    const { stored, response } = await authorized((state) =>
      cloudFetch(target, {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `DPoP ${state.access_token}`,
          DPoP: createProof(
            importPrivateKey(state.privateJwk),
            state.publicJwk,
            "POST",
            target,
            state.access_token,
          ),
          "User-Agent": desktopUserAgent,
        },
      }),
    );
    if (!stored) throw new Error("Sign in to download Astral packages.");
    if (response.status === 401) {
      const failureCode = await readProblemCode(response);
      await vault.forget(`облако не приняло свежий access (${failureCode})`, {
        onlyIfAccess: stored.access_token,
      });
      throw new Error(
        `Astral cloud session is no longer valid (${failureCode}).`,
      );
    }
    /* Мод скрыт от тестеров: человеку — слова, а не «не получилось» (классифицирует installFailure.js). */
    if (response.status === 403 && (await readProblemCode(response)) === "CATALOG_CLOSED")
      throw new Error("Этот мод сейчас недоступен для установки (CATALOG_CLOSED).");
    return parseDownloadGrantV1Response(response, { now });
  }

  async function libraryFavorites() {
    const payload = await authenticatedJSON(
      "GET",
      "/api/v1/app/library/favorites",
    );
    if (
      !payload ||
      Object.keys(payload).sort().join(",") !== "mod_ids" ||
      !Array.isArray(payload.mod_ids) ||
      payload.mod_ids.length > 1000 ||
      payload.mod_ids.some((id) => !validUUID(id))
    ) {
      throw new Error("Astral cloud returned an invalid favorites projection.");
    }
    return payload.mod_ids;
  }

  async function rating(modID) {
    if (!validUUID(modID)) throw new Error("Invalid Astral rating identifier.");
    return projectRating(
      await authenticatedJSON("GET", `/api/v1/app/catalog/${modID}/rating`),
      false,
    );
  }

  async function setRating(input) {
    if (
      !exactLibraryKeys(input, ["modId", "value"]) ||
      !validUUID(input.modId) ||
      !Number.isInteger(input.value) ||
      input.value < 1 ||
      input.value > 5
    ) {
      throw new Error("Invalid Astral rating mutation.");
    }
    return projectRating(
      await authenticatedJSON(
        "PUT",
        `/api/v1/app/catalog/${input.modId}/rating`,
        { body: { value: input.value } },
      ),
      true,
    );
  }

  async function setLibraryFavorite(input) {
    if (
      !input ||
      !validUUID(input.modId) ||
      typeof input.favorite !== "boolean"
    ) {
      throw new Error("Invalid Astral favorite mutation.");
    }
    await authenticatedJSON(
      input.favorite ? "PUT" : "DELETE",
      `/api/v1/app/library/favorites/${input.modId}`,
      { noContent: true },
    );
    return { modId: input.modId, favorite: input.favorite };
  }

  async function libraryBuilds() {
    const payload = await authenticatedJSON(
      "GET",
      "/api/v1/app/library/builds",
    );
    if (
      !exactLibraryKeys(payload, ["builds"]) ||
      !Array.isArray(payload.builds) ||
      payload.builds.length > 100
    ) {
      throw new Error("Astral cloud returned an invalid builds projection.");
    }
    return payload.builds.map(projectLibraryBuild);
  }

  async function createLibraryBuild(input) {
    const body = normalizeLibraryBuildInput(input);
    const payload = await authenticatedJSON(
      "POST",
      "/api/v1/app/library/builds",
      {
        body,
        idempotencyKey: `desktop-create-${randomUUID()}`,
      },
    );
    if (!exactLibraryKeys(payload, ["build"]))
      throw new Error("Astral cloud returned an invalid build projection.");
    return projectLibraryBuild(payload.build);
  }

  async function updateLibraryBuild(input) {
    if (
      !input ||
      !validUUID(input.id) ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1
    ) {
      throw new Error("Invalid Astral cloud build mutation.");
    }
    const body = normalizeLibraryBuildInput(input);
    const payload = await authenticatedJSON(
      "PUT",
      `/api/v1/app/library/builds/${input.id}`,
      {
        body,
        version: input.version,
      },
    );
    if (!exactLibraryKeys(payload, ["build"]))
      throw new Error("Astral cloud returned an invalid build projection.");
    return projectLibraryBuild(payload.build);
  }

  async function deleteLibraryBuild(input) {
    if (
      !input ||
      !validUUID(input.id) ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1
    ) {
      throw new Error("Invalid Astral cloud build deletion.");
    }
    await authenticatedJSON(
      "DELETE",
      `/api/v1/app/library/builds/${input.id}`,
      { version: input.version, noContent: true },
    );
    return { id: input.id };
  }

  /*
   * Короткий код работы (владелец 01.11.2026): длинный код — на сервер, в ответ
   * адрес. Отвечает статусом, а не отказом: окно кладёт в буфер полный код и
   * говорит почему, и причина ему нужна словом, а не текстом исключения —
   * текст через IPC доходит обёрнутым.
   */
  async function shareWorkCode(input) {
    if (
      !exactLibraryKeys(input, ["code"]) ||
      typeof input.code !== "string" ||
      !SHARED_WORK_CODE.test(input.code)
    ) {
      throw new Error("Invalid Astral work code.");
    }
    if (Buffer.byteLength(input.code, "utf8") > SHARED_WORK_CODE_MAX_BYTES)
      return { status: "too-large" };
    if (!(await currentState())) return { status: "signin" };
    let payload;
    try {
      payload = await authenticatedJSON("POST", "/api/v1/app/work-codes", {
        body: { code: input.code },
        timeoutMs: SHARED_WORK_CODE_TIMEOUT_MS,
      });
    } catch (error) {
      /* 403 — места на сервере нет (свои старые записи сервер освобождает сам), 413 — код больше потолка сервера, 429 — лимит частоты: у каждого свои слова. */
      if (error?.status === 403) return { status: "quota" };
      if (error?.status === 413) return { status: "too-large" };
      if (error?.status === 429) return { status: "busy" };
      /* Вход сгорел во время запроса (401 стирает учётку) — то же, что не вошёл. */
      const signedIn = await currentState().catch(() => null);
      return { status: signedIn ? "unavailable" : "signin" };
    }
    if (
      !exactLibraryKeys(payload, ["id"]) ||
      !SHARED_WORK_CODE_ID.test(payload.id)
    ) {
      return { status: "unavailable" };
    }
    return { status: "ok", code: `ASTRAL-${payload.id}` };
  }

  /* Запись по короткому коду. Публичный путь: другу входить незачем, код работы
     и раньше открывался без аккаунта. Сервер не считается доверенным: дальше
     запись идёт тем же разбором, что вставленный текст. */
  async function openSharedWorkCode(input) {
    if (
      !exactLibraryKeys(input, ["id"]) ||
      !SHARED_WORK_CODE_ID.test(input.id)
    ) {
      throw new Error("Invalid Astral work code address.");
    }
    try {
      const target = new URL(
        `/api/v1/public/work-codes/${input.id}`,
        cloudOrigin,
      ).toString();
      const response = await cloudFetch(
        target,
        {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          headers: {
            Accept: "application/json, application/problem+json",
            "User-Agent": desktopUserAgent,
          },
        },
        SHARED_WORK_CODE_TIMEOUT_MS,
      );
      if (response.status === 404) {
        await response.body?.cancel?.().catch(() => {});
        return { status: "missing" };
      }
      /* Лимит чтений на сетевой префикс: это не «сервер недоступен», через минуту откроется. */
      if (response.status === 429) {
        await response.body?.cancel?.().catch(() => {});
        return { status: "busy" };
      }
      const contentType = response.headers.get("content-type") || "";
      if (
        response.status !== 200 ||
        !contentType.toLowerCase().startsWith("application/json")
      ) {
        await response.body?.cancel?.().catch(() => {});
        return { status: "unavailable" };
      }
      /* Запас сверху — кавычки и ключ вокруг кода. */
      const payload = JSON.parse(
        await readBoundedLibraryText(
          response,
          SHARED_WORK_CODE_MAX_BYTES + 1024,
        ),
      );
      if (
        !exactLibraryKeys(payload, ["code"]) ||
        typeof payload.code !== "string"
      ) {
        return { status: "unavailable" };
      }
      return { status: "ok", code: payload.code };
    } catch {
      return { status: "unavailable" };
    }
  }

  async function telemetry(input) {
    const body = normalizeDesktopTelemetry(input);
    await authenticatedJSON("POST", "/api/v1/app/events", {
      body,
      noContent: true,
    });
    return { accepted: body.events.length };
  }

  /*
   * Отчёты об ошибках приложения (Т-130). Вошедший человек шлёт их тем же
   * каналом, что остальную телеметрию, — с DPoP; остальные — узким публичным
   * путём с id установки (случайный UUID, не аккаунт). Офлайн и отказ —
   * исключение: очередь отчётов остаётся на диске.
   */
  async function reportErrors(input) {
    const events = input?.events;
    if (
      !validUUID(input?.clientId) ||
      !Array.isArray(events) ||
      events.length < 1 ||
      events.length > 20 ||
      !events.every(
        (event) =>
          exactLibraryKeys(event, ["error", "type"]) &&
          (event.type === "error" || event.type === "crash") &&
          validWireReport(event.error),
      )
    ) {
      throw new Error("Invalid Astral error report batch.");
    }
    const stored = await currentState().catch(() => null);
    if (stored) {
      await authenticatedJSON("POST", "/api/v1/app/events", {
        body: { events },
        noContent: true,
      });
      return { accepted: events.length, channel: "account" };
    }
    const target = new URL("/api/v1/public/app-errors", cloudOrigin).toString();
    const response = await cloudFetch(target, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: {
        Accept: "application/json, application/problem+json",
        "Content-Type": "application/json",
        "User-Agent": desktopUserAgent,
      },
      body: JSON.stringify({ client_id: input.clientId, events }),
    });
    if (response.status !== 204) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error(
        `Astral error report was not accepted (${response.status}).`,
      );
    }
    return { accepted: events.length, channel: "public" };
  }

  /*
   * Журнал к отчёту об ошибке (договор с бэкендом 14.10.2026): вошедший
   * человек после принятого отчёта шлёт вычищенный журнал — тот же текст, что
   * «Скачать для тикета», — gzip-ом, а бот кладёт его в канал команды. Ответ —
   * словом, не исключением: `sent`, `absent` (404 — облако ещё без приёма
   * журналов), `limited` с `retryAfterMs`, `rejected` (400/413), `signed-out`.
   */
  async function uploadErrorLog({ fingerprint, kind, appVersion, body }) {
    if (
      !/^[0-9a-f]{8,32}$/.test(fingerprint || "") ||
      !/^[A-Za-z][A-Za-z0-9_.:\- ]{0,63}$/.test(kind || "") ||
      !/^[0-9A-Za-z.+-]{1,32}$/.test(appVersion || "") ||
      !(body instanceof Uint8Array) ||
      body.byteLength < 1 ||
      body.byteLength > ERROR_LOG_MAX_BYTES
    ) {
      throw new Error("Invalid Astral error log.");
    }
    const target = new URL("/api/v1/app/error-logs", cloudOrigin).toString();
    const { stored, response } = await authorized((state) =>
      cloudFetch(target, {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        headers: {
          Accept: "application/json, application/problem+json",
          Authorization: `DPoP ${state.access_token}`,
          DPoP: createProof(
            importPrivateKey(state.privateJwk),
            state.publicJwk,
            "POST",
            target,
            state.access_token,
          ),
          "User-Agent": desktopUserAgent,
          "Content-Type": "application/gzip",
          "Astral-Error-Fingerprint": fingerprint,
          "Astral-Error-Kind": kind,
          "Astral-App-Version": appVersion,
        },
        body,
      }),
    );
    if (!stored) return { status: "signed-out" };
    await response.body?.cancel?.().catch(() => {});
    if (response.status === 201) return { status: "sent" };
    if (response.status === 404) return { status: "absent" };
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      return {
        status: "limited",
        retryAfterMs:
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60 * 60 * 1000,
      };
    }
    if (response.status === 400 || response.status === 413)
      return { status: "rejected", code: response.status };
    throw new Error(`Astral error log was not accepted (${response.status}).`);
  }

  async function authenticatedJSON(method, pathname, options = {}) {
    const target = new URL(pathname, cloudOrigin).toString();
    const { stored, response } = await authorized((state) =>
      cloudFetch(
        target,
        {
          method,
          redirect: "error",
          credentials: "omit",
          headers: {
            Accept: "application/json, application/problem+json",
            Authorization: `DPoP ${state.access_token}`,
            DPoP: createProof(
              importPrivateKey(state.privateJwk),
              state.publicJwk,
              method,
              target,
              state.access_token,
            ),
            "User-Agent": desktopUserAgent,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.version ? { "If-Match": `"${options.version}"` } : {}),
            ...(options.idempotencyKey
              ? { "Idempotency-Key": options.idempotencyKey }
              : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        },
        options.timeoutMs,
      ),
    );
    if (!stored) throw new Error("Sign in to use Astral cloud library.");
    if (response.status === 401) {
      const failureCode = await readProblemCode(response);
      await vault.forget(`облако не приняло свежий access (${failureCode})`, {
        onlyIfAccess: stored.access_token,
      });
      throw new Error(
        `Astral cloud session is no longer valid (${failureCode}).`,
      );
    }
    if (transientStatus(response.status)) {
      await response.body?.cancel?.().catch(() => {});
      throw Object.assign(cloudUnreachable(), { status: response.status });
    }
    if (!response.ok || (options.noContent && response.status !== 204)) {
      await response.body?.cancel?.().catch(() => {});
      throw Object.assign(new Error("Astral cloud request failed."), {
        status: response.status,
      });
    }
    if (options.noContent) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error("Astral cloud returned an invalid content type.");
    }
    const text = await readBoundedLibraryText(response);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Astral cloud returned invalid library JSON.");
    }
  }

  async function logout() {
    catalogAccess.forget();
    grantReuse.clear();
    let stored = null;
    try {
      stored = await currentState();
      if (stored) {
        const target = new URL("/api/v1/app/session", cloudOrigin).toString();
        const privateKey = importPrivateKey(stored.privateJwk);
        await fetchImpl(target, {
          method: "DELETE",
          redirect: "error",
          headers: {
            Authorization: `DPoP ${stored.access_token}`,
            DPoP: createProof(
              privateKey,
              stored.publicJwk,
              "DELETE",
              target,
              stored.access_token,
            ),
            "User-Agent": desktopUserAgent,
          },
        });
      }
    } catch {
      // Local logout is final even if the server is temporarily unreachable.
    } finally {
      await vault.forget("выход из аккаунта");
    }
    /* Без входа — каталог гостя: командное не остаётся на экране. */
    reloadCatalog("выход из аккаунта");
    return { ok: true };
  }

  /*
   * Ссылка на мод, которой делятся в Discord (Т-29). Discord делает ссылкой
   * только http(s), а `astral://mods/<id>` — нет; сайт облака по
   * `/mods?mod=<id>` показывает мод и «Открыть в Astral». Только мод
   * облачного каталога: у локального на сайте страницы нет. Адрес облака
   * знает этот процесс — окно получает готовую ссылку, а не склеивает её.
   */
  function modLink(modID) {
    if (!validUUID(modID))
      throw new Error("Invalid Astral catalog identifier.");
    const target = new URL("/mods", cloudOrigin);
    target.searchParams.set("mod", modID);
    return { url: target.toString() };
  }

  /*
   * Прогрев канала к облаку: DNS, TCP и TLS — ещё до того, как окно спросит первое (~230 мс на соединении, на плохой сети — секунды), и часы облака: ответ несёт `Date`, и
   * первая подпись DPoP уходит уже по ним, а не после отказа и повтора (`withServerClock`). Запрос без входа: ответ `401` не важен, нужен канал. Сбой не ошибка — запишется в «Логи».
   */
  async function warmCloud() {
    const began = performance.now();
    try {
      const target = new URL("/api/v1/app/catalog/access", cloudOrigin).toString();
      const response = await fetchWithin(
        fetchImpl,
        target,
        { method: "GET", redirect: "error", credentials: "omit", headers: { Accept: "application/json", "User-Agent": desktopUserAgent } },
        timeoutMs,
      );
      learnServerClock(response);
      await response.body?.cancel?.().catch(() => {});
      note("info", `облако: канал прогрет за ${Math.round(performance.now() - began)} мс`);
    } catch (error) {
      note("warn", `облако: канал не прогрелся за ${((performance.now() - began) / 1000).toFixed(1)} с`, error.detail || describeError(error));
    }
  }

  return {
    warmCloud,
    login,
    isLoginPending,
    cancelLogin,
    loginLink,
    session,
    catalog,
    news,
    showcase,
    showcaseEvents,
    modLink,
    downloadGrant,
    rating,
    setRating,
    libraryFavorites,
    setLibraryFavorite,
    libraryBuilds,
    createLibraryBuild,
    shareWorkCode,
    openSharedWorkCode,
    updateLibraryBuild,
    deleteLibraryBuild,
    telemetry,
    reportErrors,
    uploadErrorLog,
    logout,
    diagnoseSession,
  };
}

/* Короткий код: что можно выложить и как выглядит адрес. Те же правила — в
   `backend/internal/platform/workshare`. Покрытие договора — `tests/work-code-cloud.test.js`. */
const SHARED_WORK_CODE = /^(?:ASTRAL-[A-Z]+\d{1,3}-|ASTR[12]-)[A-Za-z0-9_.-]+$/;
const SHARED_WORK_CODE_ID = /^[2-9A-HJ-NP-Z]{10}$/;
const SHARED_WORK_CODE_MAX_BYTES = 1 << 20;
/* Записи кода — до мегабайта в обе стороны, а сервер даёт телу запроса 30 с. Общие 8 с облака (`CLOUD_TIMEOUT_MS`) рвали их на обычной домашней отдаче. */
const SHARED_WORK_CODE_TIMEOUT_MS = 60_000;

async function readProblemCode(response) {
  try {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/problem+json")) {
      await response.body?.cancel?.().catch(() => {});
      return "UNEXPECTED_RESPONSE";
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 4096) return "OVERSIZED_RESPONSE";
    const parsed = JSON.parse(text);
    return /^[A-Z][A-Z0-9_]{1,63}$/.test(parsed?.code || "")
      ? parsed.code
      : "INVALID_PROBLEM";
  } catch {
    return "UNREADABLE_PROBLEM";
  }
}

function validUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value || "",
  );
}

function exactLibraryKeys(value, expected) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...expected].sort().join(",")
  );
}

function projectRating(value, requireValue) {
  if (
    !exactLibraryKeys(value, ["average", "count", "value"]) ||
    !Number.isInteger(value.value) ||
    value.value < (requireValue ? 1 : 0) ||
    value.value > 5 ||
    !Number.isFinite(value.average) ||
    value.average < 0 ||
    value.average > 5 ||
    !Number.isSafeInteger(value.count) ||
    value.count < 0 ||
    (value.count === 0 && (value.average !== 0 || value.value !== 0)) ||
    (value.count > 0 && value.average < 1)
  ) {
    throw new Error("Astral cloud returned an invalid rating projection.");
  }
  return { value: value.value, average: value.average, count: value.count };
}

const desktopTelemetryPaths = new Set([
  "/app",
  "/app/catalog",
  "/app/workshop",
  "/app/installed",
  "/app/builds",
  "/app/settings",
]);

function normalizeDesktopTelemetry(input) {
  if (
    !exactLibraryKeys(input, ["events"]) ||
    !Array.isArray(input.events) ||
    input.events.length < 1 ||
    input.events.length > 100
  ) {
    throw new Error("Invalid Astral desktop telemetry batch.");
  }
  const events = input.events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("Invalid Astral desktop telemetry event.");
    }
    if (event.type === "heartbeat" && exactLibraryKeys(event, ["type"])) {
      return { type: "heartbeat" };
    }
    if (
      event.type === "visit" &&
      exactLibraryKeys(event, ["path", "type"]) &&
      desktopTelemetryPaths.has(event.path)
    ) {
      return { type: "visit", path: event.path };
    }
    if (
      event.type === "catalog_download" &&
      exactLibraryKeys(event, ["mod_id", "type"]) &&
      validUUID(event.mod_id)
    ) {
      return { type: "catalog_download", mod_id: event.mod_id };
    }
    throw new Error("Invalid Astral desktop telemetry event.");
  });
  return { events };
}

function normalizeLibraryBuildInput(input) {
  if (
    !input ||
    typeof input.name !== "string" ||
    input.name.trim() !== input.name ||
    input.name.length < 1 ||
    input.name.length > 120 ||
    !Array.isArray(input.items) ||
    input.items.length > 200
  ) {
    throw new Error("Invalid Astral cloud build.");
  }
  const seen = new Set();
  const items = input.items.map((item) => {
    if (
      !exactLibraryKeys(item, ["mod_id", "release_id"]) ||
      !validUUID(item.mod_id) ||
      !validUUID(item.release_id) ||
      seen.has(item.mod_id)
    ) {
      throw new Error("Invalid Astral cloud build item.");
    }
    seen.add(item.mod_id);
    return { mod_id: item.mod_id, release_id: item.release_id };
  });
  return { name: input.name, items };
}

function projectLibraryBuild(build) {
  if (
    !exactLibraryKeys(build, [
      "created_at",
      "id",
      "items",
      "name",
      "updated_at",
      "version",
    ]) ||
    !validUUID(build.id) ||
    typeof build.name !== "string" ||
    build.name.trim() !== build.name ||
    build.name.length < 1 ||
    build.name.length > 120 ||
    !Number.isSafeInteger(build.version) ||
    build.version < 1 ||
    !Array.isArray(build.items) ||
    build.items.length > 200 ||
    Number.isNaN(Date.parse(build.created_at)) ||
    Number.isNaN(Date.parse(build.updated_at))
  ) {
    throw new Error("Astral cloud returned an invalid build projection.");
  }
  const seen = new Set();
  const items = build.items.map((item, ordinal) => {
    if (
      !exactLibraryKeys(item, ["mod_id", "ordinal", "release_id"]) ||
      !validUUID(item.mod_id) ||
      !validUUID(item.release_id) ||
      item.ordinal !== ordinal ||
      seen.has(item.mod_id)
    ) {
      throw new Error("Astral cloud returned an invalid build item.");
    }
    seen.add(item.mod_id);
    return { modId: item.mod_id, releaseId: item.release_id };
  });
  return Object.freeze({
    id: build.id,
    name: build.name,
    version: build.version,
    modIds: Object.freeze(items.map((item) => item.modId)),
    items: Object.freeze(items),
    createdAt: build.created_at,
    updatedAt: build.updated_at,
    cloud: true,
  });
}

async function readBoundedLibraryText(response, maximumBytes = 256 * 1024) {
  const declared = Number(response.headers.get("content-length") || "0");
  if (!Number.isFinite(declared) || declared < 0 || declared > maximumBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error("Astral cloud returned an oversized library response.");
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumBytes)
      throw new Error("Astral cloud returned an oversized library response.");
    return text;
  }
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Astral cloud returned an oversized library response.");
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, length),
    );
  } catch {
    throw new Error("Astral cloud returned invalid library text.");
  }
}

/* Безопасный порт для 127.0.0.1 — общий с одноразовой ссылкой проводника (`elevation.js`). */
export { BROWSER_UNSAFE_PORTS, isBrowserUnsafePort, listenOnSafePort };

function createLoopbackCallback(expectedState) {
  let settled = false;
  let timer;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  /* Браузер может ответить раньше, чем вход начнёт ждать результат (`await openExternal`
     ещё не вернулся): отказ не должен стать «необработанным». Ждущий всё равно его получит. */
  result.catch(() => {});
  const settle = (error, code = "") => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    server.close();
    if (error) rejectResult(error);
    else resolveResult(code);
    return true;
  };
  const server = createServer((request, response) => {
    const target = new URL(request.url || "/", "http://127.0.0.1");
    const code = target.searchParams.get("code") || "";
    const state = target.searchParams.get("state") || "";
    const refusal = target.searchParams.get("error") || "";
    const ours =
      request.method === "GET" &&
      target.pathname === "/oauth/callback" &&
      state === expectedState;
    const valid = ours && /^[A-Za-z0-9_-]{43}$/.test(code);
    /* Сайт отказал во входе и сказал об этом сразу (`?error=<код>&state=…`), а не
       оставил окно ждать до конца срока (`LOGIN_BROWSER_WAIT_MS`). Принимается только со своим `state`. */
    const refused = ours && !valid && /^[a-z0-9_]{1,40}$/.test(refusal);
    /* Страница в стиле Astral на языке браузера (oauth-callback-page.js). */
    response.writeHead(valid || refused ? 200 : 400, CALLBACK_PAGE_HEADERS);
    response.end(
      oauthCallbackPage({
        ok: valid,
        refused,
        language: callbackLanguage(request.headers["accept-language"]),
      }),
    );
    if (valid) return void settle(null, code);
    if (refused) {
      const failure = new Error(loginRefusalText(refusal));
      failure.loginRefusal = refusal;
      return void settle(failure);
    }
    settle(new Error(LOGIN_CALLBACK_REJECTED_TEXT));
  });
  return listenOnSafePort(server).then((port) => {
    timer = setTimeout(() => {
      settle(new Error(LOGIN_TIMEOUT_TEXT));
    }, LOGIN_BROWSER_WAIT_MS);
    return {
      redirectUri: `http://127.0.0.1:${port}/oauth/callback`,
      result,
      cancel: () => settle(new Error(LOGIN_CANCELLED_TEXT)),
      close: () => {
        clearTimeout(timer);
        server.close();
      },
    };
  });
}

/*
 * Часы компьютера против часов облака (21.10.2026). Подпись DPoP несёт своё
 * время (`iat`), и облако не принимает подпись из прошлого или будущего: у
 * владельца часы Windows отставали на три часа (часовой пояс), сайт входил, а
 * лаунчер — нет («client clock off by -10800s» в журнале edge). Сдвиг берётся
 * из заголовка Date ответов облака; меньше минуты — не сдвиг: Date точен до
 * секунды, и сеть добавляет задержку. Сдвиг — свойство компьютера, поэтому он
 * общий на процесс.
 */
const CLOCK_SKEW_MS = 60_000;
let serverClockOffsetMs = 0;

export const LOGIN_CLOCK_TEXT =
  "Часы компьютера сбиты, и облако Astral не приняло вход. Включите «Устанавливать время автоматически» в настройках Windows и войдите снова.";
export const LOGIN_REFUSED_TEXT = "Облако Astral не приняло вход. Попробуйте войти ещё раз.";
/* Браузер не вернул вход вовремя / вернул что-то не то: слова, а не текст протокола (словарь окна —
   `locales/ui-text/zone-h3-login-2410.js`). Отмену окно узнаёт по английской фразе и ничего не показывает. */
export const LOGIN_TIMEOUT_TEXT =
  "Браузер не вернул вход за 15 минут. Нажмите «Войти» и закончите вход на сайте ещё раз.";
export const LOGIN_CALLBACK_REJECTED_TEXT =
  "Ссылка входа из браузера не подошла. Нажмите «Войти» и войдите на сайте ещё раз.";
export const LOGIN_CANCELLED_TEXT = "Desktop authorization was cancelled.";
/* Сколько вход ждёт возврата из браузера. 15 минут (ТЗ 24.10.2026, п. 7): вход владельца на сайте шёл 7 минут, а лаунчер
   ждал 5 — дальше браузер уходил на закрытый порт. Ждать дольше безопасно: есть «Отменить вход». Число в `LOGIN_TIMEOUT_TEXT`
   и его переводах (`zone-h3-login-2410.js`) — то же; тест держит их вместе. */
export const LOGIN_BROWSER_WAIT_MS = 15 * 60_000;
/* Сколько вход ждёт, что браузер откроется (`openExternal` вернётся). Из-под администратора открытие само ждёт
   браузер до 10 с (`elevation.js`, `BROWSER_OPEN_GRACE_MS`) и потом открывает напрямую — потолок выше этого. */
export const LOGIN_BROWSER_OPEN_WAIT_MS = 25_000;
/* Обмен кода на токены: дольше обычного запроса (первая подпись, холодное соединение), но не вечно. */
export const LOGIN_EXCHANGE_TIMEOUT_MS = 20_000;

/* Отказ сайта словами. Код — тот, что край кладёт в `discord_error` / `beta_error`
   (`backend/internal/services/edge/discord.go`); неизвестный — общая фраза. */
const LOGIN_BETA_REQUIRED_TEXT =
  "Для входа нужен код доступа: получите его у бота Astral в Discord и введите на сайте.";
const LOGIN_BETA_CODE_TEXT =
  "Код доступа не подошёл. Проверьте его на сайте или получите новый у бота Astral в Discord.";
export const LOGIN_NO_ACCOUNT_TEXT =
  "Для этого Discord нет аккаунта Astral. Нажмите «Продолжить с Discord» ещё раз — аккаунт создастся сам.";
/* Человек снял галочку в окне Discord: без разрешения вступить на сервер Astral mods вход не завершается (код `scope`, дизайн 15.11.2026).
   Слово в слово повторено в `features/onboarding/login-failure.js` (окно узнаёт отказ по тексту) и в словаре окна. */
export const LOGIN_SCOPE_TEXT =
  "Нужно разрешить Astral добавить вас на сервер Astral mods. Начните вход заново и не снимайте галочки.";
export const LOGIN_CONFLICT_TEXT = "Этот Discord уже привязан к другому аккаунту Astral.";
export const LOGIN_BLOCKED_TEXT = "Аккаунт Astral заблокирован.";
export const LOGIN_RATE_TEXT = "Слишком много попыток входа. Подождите минуту и войдите ещё раз.";
const LOGIN_SITE_REFUSALS = Object.freeze({
  cancelled: LOGIN_CANCELLED_TEXT,
  access_denied: LOGIN_CANCELLED_TEXT,
  beta_code_required: LOGIN_BETA_REQUIRED_TEXT,
  beta_code_wrong_user: LOGIN_BETA_CODE_TEXT,
  beta_code_used: LOGIN_BETA_CODE_TEXT,
  beta_code_expired: LOGIN_BETA_CODE_TEXT,
  beta_code_revoked: LOGIN_BETA_CODE_TEXT,
  beta_code_invalid: LOGIN_BETA_CODE_TEXT,
  beta_code_reinstall: LOGIN_BETA_CODE_TEXT,
  no_account: LOGIN_NO_ACCOUNT_TEXT,
  scope: LOGIN_SCOPE_TEXT,
  conflict: LOGIN_CONFLICT_TEXT,
  blocked: LOGIN_BLOCKED_TEXT,
  rate: LOGIN_RATE_TEXT,
});

export function loginRefusalText(code) {
  return LOGIN_SITE_REFUSALS[code] ?? LOGIN_REFUSED_TEXT;
}

/** Чем кончилось ожидание браузера — одной строкой для «Логов». */
export function describeLoginWait(error) {
  if (error?.loginRefusal) return `сайт отказал во входе: ${error.loginRefusal}`;
  const message = String(error?.message || error || "");
  if (message === LOGIN_CANCELLED_TEXT)
    return "ожидание отменено (окно вернуло фокус или нажато «Отменить вход»)";
  if (message === LOGIN_TIMEOUT_TEXT)
    return `браузер не вернул код за ${LOGIN_BROWSER_WAIT_MS / 60_000} мин`;
  if (message === LOGIN_CALLBACK_REJECTED_TEXT)
    return "возврат из браузера отклонён: чужое состояние или код неверной формы";
  return `ожидание браузера оборвалось: ${describeError(error)}`;
}

export function learnServerClock(response, localNow = Date.now()) {
  const server = Date.parse(response?.headers?.get?.("date") || "");
  if (!Number.isFinite(server)) return;
  const offset = server - localNow;
  serverClockOffsetMs = Math.abs(offset) >= CLOCK_SKEW_MS ? offset : 0;
}

export function serverClockOffset() {
  return serverClockOffsetMs;
}

/* Для проверок: начать с «часы совпадают». */
export function resetServerClock() {
  serverClockOffsetMs = 0;
}

function describeClockSkew() {
  if (!serverClockOffsetMs) return "";
  const minutes = Math.round(serverClockOffsetMs / 60_000);
  return `часы компьютера ${minutes < 0 ? "впереди" : "позади"} облака на ${Math.abs(minutes)} мин`;
}

/*
 * Запрос с подписью DPoP: облако отказало, а по его часам наша подпись ушла
 * со сдвигом — один повтор, подпись строится заново уже по часам облака.
 */
async function withServerClock(send, onRetry = () => {}) {
  const used = serverClockOffsetMs;
  let response = await send();
  learnServerClock(response);
  if (response.ok || Math.abs(serverClockOffsetMs - used) < CLOCK_SKEW_MS) return response;
  await response.body?.cancel?.().catch(() => {});
  onRetry();
  response = await send();
  learnServerClock(response);
  return response;
}

function createProof(privateKey, publicJwk, method, target, accessToken = "") {
  const header = b64url(
    JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: publicJwk }),
  );
  const claims = {
    jti: randomUUID(),
    htm: method,
    htu: target,
    iat: Math.floor((Date.now() + serverClockOffsetMs) / 1000),
  };
  if (accessToken) claims.ath = b64url(sha256(accessToken));
  const payload = b64url(JSON.stringify(claims));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64url(signature)}`;
}

function jwkThumbprint(jwk) {
  return b64url(
    sha256(JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y })),
  );
}

function importPrivateKey(jwk) {
  return createPrivateKey({ key: jwk, format: "jwk" });
}

/*
 * Два разных «облако не пустило».
 *
 * Облако ОТКАЗАЛО: refresh-токен отозван или истёк (`400 invalid_grant`),
 * access не принят (`401`). Учётка мертва — её стирают, окно просит войти.
 *
 * Облако НЕ ОТВЕТИЛО: нет сети, DNS, таймаут, 5xx, 429. Учётка жива, и
 * стирать её нельзя — окно работает с тем, что есть на компьютере, и
 * переподключается само.
 *
 * Разница едет в поле `kind` ошибки: главный процесс решает по нему сам, а
 * окну отдаёт уже ответ (см. `session`).
 */
export const CLOUD_TIMEOUT_MS = 8000;
/* Запрос к облаку дольше этого пишется в «Логи» со временем; сорвавшийся — всегда. */
const SLOW_REQUEST_MS = 2000;
/* Проваленное обновление токена не повторяется чаще: ждущие в очереди входа получают тот же отказ сразу (`currentState`). Пауза короче шага переподключения, «Повторить» её не чувствует. */
const REFRESH_RETRY_GAP_MS = 1500;
/* Бюджет вопроса «открыт ли каталог» для запомненного каталога без метки аккаунта. */
export const OPEN_CHECK_BUDGET_MS = 1500;

function cloudFailure(kind, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.kind = kind;
  return error;
}

function cloudUnreachable(cause) {
  const error = cloudFailure(
    "unreachable",
    "Нет связи с облаком Astral. Проверьте интернет — Astral повторит сам.",
    cause,
  );
  if (cause) error.detail = describeError(cause);
  return error;
}

/*
 * Облако ответило, но так, что о входе судить нельзя: 403 от прокси, страница
 * входа гостиничного Wi-Fi вместо JSON, `invalid_request` неверно настроенного
 * сервера. Для окна это то же «не ответило» — учётка жива, — а в журнале
 * записано, что именно пришло.
 */
function cloudUnclear(cause) {
  const error = cloudFailure(
    "unreachable",
    "Нет связи с облаком Astral. Проверьте интернет — Astral повторит сам.",
    cause,
  );
  const status = cause?.status ? `HTTP ${cause.status}` : "";
  const code = cause?.oauth ? ` ${cause.oauth}` : "";
  error.detail = `ответ облака непонятен: ${status}${code}`.trim();
  return error;
}

function cloudRejected(cause) {
  const error = cloudFailure(
    "rejected",
    "Вход в Astral закончился — войдите снова.",
    cause,
  );
  if (cause?.status)
    error.detail = `HTTP ${cause.status}${cause.oauth ? ` ${cause.oauth}` : ""}`;
  return error;
}

/* Ответы, которые говорят о связи или о сервере, а не о входе. */
function transientStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/*
 * Запрос к облаку с потолком по времени. Без него сеть, которая молча
 * глотает пакеты (гостиничный Wi-Fi, фаервол), держала заставку старта
 * минутами: у fetch нет своего таймаута на соединение, которое не рвётся.
 */
async function fetchWithin(fetchImpl, target, options, timeoutMs) {
  try {
    return await fetchImpl(target, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw cloudUnreachable(error);
  }
}

/*
 * Профиль, запомненный рядом с учёткой: без сети окно открывается тем же
 * человеком, а не экраном входа. Хранится то, что прислало облако, в тех же
 * границах, что проверяет его ответ; всё прочее — «профиля нет».
 */
function storedProfile(user) {
  if (!user || typeof user !== "object") return null;
  const { id, display_name: displayName, email, avatar_url: avatarUrl } = user;
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 64 ||
    // Учётка, созданная входом через Discord (Т-128), без почты.
    typeof email !== "string" ||
    email.length > 320 ||
    typeof displayName !== "string" ||
    displayName.length > 120
  )
    return null;
  /* Аватар — украшение: негодный адрес не рушит профиль, а лишь остаётся без картинки (инициалы). */
  return { id, display_name: displayName, email, avatar_url: discordAvatarUrl(avatarUrl) };
}

function sameProfile(left, right) {
  return (
    left?.id === right.id &&
    left?.display_name === right.display_name &&
    left?.email === right.email &&
    (left?.avatar_url ?? "") === right.avatar_url
  );
}

/*
 * Аватар из Discord. Облако кладёт его в `user.avatar_url` при каждом входе через
 * Discord; окно рисует его картинкой (CSP пускает `https://cdn.discordapp.com`
 * только для img). Верим форме, а не серверу: свой хост без «двойника»
 * (`cdn.discordapp.com.evil.example`), путь `avatars/<id>/<хэш>.<тип>` и, если
 * есть, размер — больше ничего. Нет аватара или адрес чужой — пустая строка.
 */
const DISCORD_AVATAR =
  /^https:\/\/cdn\.discordapp\.com\/avatars\/[0-9]{15,25}\/(?:a_)?[0-9a-f]{32}\.(?:png|webp|jpg|jpeg|gif)(?:\?size=[0-9]{2,4})?$/;

export function discordAvatarUrl(value) {
  return typeof value === "string" && value.length <= 200 && DISCORD_AVATAR.test(value) ? value : "";
}

function rememberedUser(user) {
  const profile = storedProfile(user);
  return profile ? normalizeUser(profile) : null;
}

async function parseTokens(response) {
  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw cloudUnreachable(error);
  }
  if (Buffer.byteLength(text, "utf8") > 4096)
    throw new Error("Astral cloud returned an oversized token response.");
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch {}
  if (!payload || typeof payload !== "object") payload = {};
  const keys = Object.keys(payload).sort().join(",");
  const refreshExpiry = Date.parse(payload.refresh_expires_at || "");
  if (
    !response.ok ||
    keys !==
      "access_token,expires_in,refresh_expires_at,refresh_token,token_type" ||
    payload.token_type !== "DPoP" ||
    !/^[A-Za-z0-9_-]{43}$/.test(payload.access_token || "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(payload.refresh_token || "") ||
    payload.expires_in !== 300 ||
    !Number.isFinite(refreshExpiry) ||
    refreshExpiry <= Date.now()
  ) {
    const refused = new Error("Astral cloud rejected desktop authorization.");
    refused.status = response.status;
    /* OAuth-код отказа (`invalid_grant`): по нему главный процесс отличает
       «вход закончился» от «ответ облака непонятен». */
    if (typeof payload.error === "string") refused.oauth = payload.error;
    throw refused;
  }
  return payload;
}

/* Пустая строка — запись годна; иначе причина, которая уйдёт в журнал. */
function invalidStoredState(value) {
  const shaped =
    value &&
    value.privateJwk?.d &&
    value.publicJwk?.x &&
    value.publicJwk?.y &&
    /^[A-Za-z0-9_-]{43}$/.test(value.access_token || "") &&
    /^[A-Za-z0-9_-]{43}$/.test(value.refresh_token || "") &&
    Number.isFinite(value.accessExpiresAt);
  if (!shaped) return "запись учётки повреждена";
  if (!(Date.parse(value.refresh_expires_at || "") > Date.now()))
    return "срок refresh-токена вышел — нужен новый вход";
  return "";
}

function normalizeUser(user) {
  return {
    id: user.id,
    name: user.display_name,
    displayName: user.display_name,
    email: user.email,
    avatarUrl: user.avatar_url || "",
    role: "user",
  };
}

/*
 * Локальный каталог (dev и локальная сборка): моды, опубликованные на этой
 * машине во «Публикации», и служебные пакеты диагностики. Раньше он пускал
 * только двадцать id из списка и весь рушился на первом чужом — а после
 * выгрузки Discord во «Входящих» тысячи модов, и у «предпросмотра» и работы
 * мастерской пакета нет вовсе. Теперь каждый мод проверяется сам по себе:
 * подписанный пакет — строго, как прежде (подпись, id манифеста, адрес
 * пакета на своём loopback); мод без пакета — только без манифеста и адреса.
 * Негодный мод отбрасывается, каталог остаётся.
 */
const LOCAL_CATALOG_LIMIT = 5_000;
const LOCAL_CATALOG_BYTES = 32 * 1024 * 1024;
const LOCAL_MOD_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const LOCAL_INTERNAL_IDS = new Set(["safeswitch-doctor", "safeswitch-beacon"]);

function localCatalogMod(mod, origin) {
  if (
    !mod ||
    typeof mod !== "object" ||
    !LOCAL_MOD_ID.test(String(mod.id || "")) ||
    typeof mod.name !== "string" ||
    !mod.name.trim() ||
    Boolean(mod.internal) !== LOCAL_INTERNAL_IDS.has(mod.id)
  )
    return null;
  let rebased = null;
  if (mod.manifest) {
    let packageURL;
    try {
      packageURL = new URL(mod.packageBaseUrl || "");
    } catch {
      return null;
    }
    /* Пакет лежит у нашего же локального API, а порт у собранного Desktop
       случайный: в каталоге остался порт, на котором мод публиковали (4174
       песочницы). Loopback-адрес переносится на текущий origin — пакет
       по-прежнему берётся только у себя; чужой хост — отказ, как раньше. */
    if (
      packageURL.origin !== new URL(origin).origin &&
      packageURL.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(packageURL.hostname) &&
      isLoopbackHTTPOrigin(origin)
    ) {
      packageURL = new URL(packageURL.pathname, origin);
      rebased = packageURL.toString();
    }
    if (
      mod.manifest.id !== mod.id ||
      !/^[A-Za-z0-9+/]{86}==$/.test(mod.manifest.signature || "") ||
      packageURL.origin !== new URL(origin).origin ||
      !packageURL.pathname.startsWith(`/api/packages/${mod.id}/`) ||
      !packageURL.pathname.endsWith("/") ||
      packageURL.search ||
      packageURL.hash
    )
      return null;
  } else if (
    mod.packageBaseUrl ||
    /* unsigned — пакет не прошёл ключ каталога (apps/api/src/trusted-catalog.js):
       карточка остаётся, установка отказывает словами. bundle — сборка
       (Т-81c): своего пакета нет, ставятся её части. */
    !["preview", "work", "unsigned", "bundle"].includes(mod.packageStatus)
  )
    return null;
  /* Сборка без состава — не сборка: ставить было бы нечего. */
  if (
    (mod.packageStatus === "bundle" || mod.publicationMode === "bundle") &&
    (mod.manifest ||
      mod.packageStatus !== mod.publicationMode ||
      !Array.isArray(mod.includedModIds) ||
      mod.includedModIds.length < 2 ||
      !mod.includedModIds.every((id) => LOCAL_MOD_ID.test(String(id))))
  )
    return null;
  return JSON.parse(
    JSON.stringify(rebased ? { ...mod, packageBaseUrl: rebased } : mod),
  );
}

async function fetchLocalTestCatalog(origin, fetchImpl) {
  if (!isLoopbackHTTPOrigin(origin)) {
    throw new Error("Invalid Astral local catalog origin.");
  }
  const target = new URL("/api/local-test-catalog", origin);
  const response = await fetchImpl(target, {
    method: "GET",
    redirect: "error",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const declared = Number(response.headers.get("content-length") || "0");
  if (
    response.status !== 200 ||
    !String(response.headers.get("content-type") || "")
      .toLowerCase()
      .startsWith("application/json") ||
    (declared && declared > LOCAL_CATALOG_BYTES)
  ) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error("Astral local test catalog is unavailable.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > LOCAL_CATALOG_BYTES) {
    throw new Error("Astral local test catalog is unavailable.");
  }
  const payload = JSON.parse(text);
  if (
    !payload ||
    !Array.isArray(payload.mods) ||
    payload.mods.length > LOCAL_CATALOG_LIMIT
  ) {
    throw new Error("Astral local test catalog is invalid.");
  }
  const seen = new Set();
  const mods = [];
  for (const raw of payload.mods) {
    const mod = localCatalogMod(raw, origin);
    if (!mod || seen.has(mod.id)) continue;
    seen.add(mod.id);
    mods.push(mod);
  }
  return { mods, platforms: [], categories: [] };
}

function validateOrigin(raw) {
  const value = new URL(raw);
  if (
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash ||
    !["https:", "http:"].includes(value.protocol)
  )
    throw new Error("ASTRAL_CLOUD_ORIGIN must be an origin.");
  if (
    value.protocol === "http:" &&
    !["127.0.0.1", "localhost"].includes(value.hostname)
  )
    throw new Error("Astral cloud requires HTTPS.");
  return value.origin;
}
