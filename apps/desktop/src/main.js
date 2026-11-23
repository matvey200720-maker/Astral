import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  safeStorage,
  session,
  shell,
  Tray,
} from "electron";
import ipcContract from "@modovik/contracts/ipc";
import { appLog } from "./app-log.js";
import { configureInstallJournal } from "./install-journal.js";
import { describeRustStatus, rustStatus } from "@modovik/native-rs"; import "./native-block-codec.js";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { betaGuard } from "./beta/guard.js";
import { readBetaBuildConfig } from "./beta/build-config.js";
import { migrateLegacyUserData, productNameFor, readOwnBranch, sharedUserDataPath } from "./channels/branches.js";
import { createDesktopChannels, installChannelArgument } from "./channels/index.js";
import { callNativeEngine } from "./native-engine.js";
import { deepLinkFromArgs, dispatchDeepLink, pendingDeepLink, registerAstralProtocol, rememberStartupDeepLink } from "./deep-link.js";
import {
  broadcastChannels,
  broadcastCloudCatalog,
  broadcastOptimizationProgress,
  broadcastUpdates,
  broadcastVanillaStatus,
  broadcastWorkshopInstallProgress,
  broadcastWorkshopProgress,
} from "./broadcast.js";
import { createUpdateService } from "./updates/index.js";
import { catalogPublicKey } from "./catalog-key.js";
import { createDesktopRockstarDelivery } from "./rockstar-delivery-desktop.js";
import { createWorkshopOperations, guardGameWrites } from "./workshop-operations.js";
import { registerDesktopShellIpc } from "./desktop-shell-ipc.js";
import { lazyAppIcon, registerAppIconIpc } from "./app-icon.js";
import { registerSystemFontsIpc } from "./system-fonts.js";
import { scheduleCacheHousekeeping } from "./cache-housekeeping.js";
import { scheduleRestorePointsAdoption } from "./restore-points-move.js";
import { registerInstallStateIpc } from "./install-state-ipc.js";
import { capChromiumCache, createDesktopStorage } from "./desktop-storage.js";
import { registerStorageIpc } from "./storage-ipc.js";
import { startPackagedServices } from "./packaged-services.js";
import { lazyWorkshopIpc } from "./workshop-ipc-lazy.js";
import { SPLASH_URL, loadAppWindow } from "./window-load.js";
import {
  cancelPendingLoginWhenWindowReturns,
  createElectronDesktopAuth,
  isLocalDesktopBuild,
  localDeveloperModeRequested,
  registerDesktopAuthIPC,
} from "./desktop-auth.js";
import { createElectronBoundary, parseDownloadHostAllowlist } from "./electron-boundary.js";
import { createDesktopIpcCrashGuard } from "./ipc-crash-guard.js";
import { installEngineCrashGuard, wireWindowRequests } from "./engine-window-wiring.js";
import { loadReleaseConfig } from "./release-config.js";
import { registerVanillaGuardIpc } from "./vanilla-guard-ipc.js";
import { createStartupRecovery } from "./startup-recovery.js";
const startupRecovery = createStartupRecovery();
import { createWindowAttention } from "./window-attention.js";
import { discoverGames } from "@modovik/game-discovery";
import {
  findGame,
  gameProcessRunning,
  legacyRuntimeGuard,
} from "./legacy-runtime-guard.js";
import { desktopShooters } from "./service-shooters.js";
import { appWindow, applyTitlebarTheme, raiseAppWindow } from "./app-window.js";
import { applyGpuPreference, guardStartup, guardWindow } from "./startup-guards.js";
import { showStartupFailure } from "./startup-failure-words.js";
import { createAppPresence, registerAppPresenceIpc } from "./app-presence.js";
const dirname = path.dirname(fileURLToPath(import.meta.url));
const { IPC_CHANNELS: IPC, assertIpcArguments } = ipcContract;
const ipcCrashGuard = createDesktopIpcCrashGuard(app);
installEngineCrashGuard(app);
const {
  ipcNonce,
  handleIpc: boundaryHandleIpc,
  onIpc,
  trusted,
  bindRenderer,
  expectIpc,
  settleIpc,
  holdIpc,
  releaseIpc,
} = createElectronBoundary({ ipcMain, assertIpcArguments, crashGuard: ipcCrashGuard });
/* Моды в копию из Rockstar Games Launcher (задача 7): пока Astral пишет в игру, архив с модами на месте. */
const rockstar = createDesktopRockstarDelivery({ app, IPC, findGame, handleIpc: boundaryHandleIpc, projectRoot: () => projectRoot, installOptions: () => desktopStorage().installOptions() });
const { handleIpc } = rockstar;
const activeOperations = new Map();
const vanillaWatchers = new Map();
const windowAttention = createWindowAttention({ IPC, powerMonitor });
const clothingShots = desktopShooters({ app, BrowserWindow, ipcMain });
/*
 * Замок изменений игры из Мастерской: и FiveM resource, и редакторы пишут в
 * файлы игры, поэтому занятость у них одна на всех — иначе окно знало бы про
 * одну операцию и не знало про другую.
 */
const workshopOperations = createWorkshopOperations({
  send: (status) => broadcastWorkshopInstallProgress(status),
  /* Очередь загрузок пишет в тот же update.rpf своим движком: пока в ней
     что-то идёт, мастерская ждёт — окно придерживает свою очередь само, а
     это последняя линия, если окно не успело. */
  otherWriter: () =>
    activeOperations.size
      ? "Дождитесь окончания установок и удалений в очереди загрузок."
      : "",
  /* После записи в игру — уборка кэша и свежие размеры «Хранилища». */
  onSettled: () => {
    scheduleCacheHousekeeping();
    void storageManager?.settle();
  },
  beforeWrite: () => storageManager?.makeRoomForGameWrite(), // место в бюджете «Хранилища» до записи
});
let localApiServer = null;
let localWebUrl = "";
let storageManager = null;
let cloudAuth = null;
let localDevelopmentBuild = false;
rememberStartupDeepLink(process.argv);
const projectRoot = path.resolve(dirname, "../../..");
const explicitStartupMode = [
  "--demo",
  "--steam-preview",
  "--first-run",
  "--registered-preview",
  "--local-developer",
].some((flag) => process.argv.includes(flag));
/*
 * `npm run dev:desktop` exists to click through the interface. There is no
 * cloud backend on a development machine to sign in against, so an unpackaged
 * run starts on the demo profile — signed in, with a sample game and catalog —
 * instead of stopping at a login it cannot complete. Set
 * ASTRAL_DEV_REQUIRE_AUTH=1 to walk the real sign-in flow locally.
 * This is gated on app.isPackaged: an installed Astral always authenticates.
 */
const devUiMode =
  !app.isPackaged &&
  !explicitStartupMode &&
  process.env.ASTRAL_DEV_REQUIRE_AUTH !== "1";
/* Бета-сборка: входа в обход аккаунта нет — флаги `--demo`, `--steam-preview`
   и их переменные окружения игнорируются (docs/beta/beta-access.md). */
const betaBuild = readBetaBuildConfig({ app }).gate === true;
const demoMode =
  !betaBuild &&
  (process.argv.includes("--demo") ||
    process.env.ASTRAL_DEMO_MODE === "1" ||
    devUiMode);
const steamPreviewMode =
  !betaBuild &&
  (process.argv.includes("--steam-preview") ||
    process.env.ASTRAL_STEAM_PREVIEW === "1");
const localDeveloperMode = localDeveloperModeRequested({ app });
/* Хосты пакетов, медиа-хост и облачный адрес, с которыми собран Astral, —
   до списка хостов ниже и до облачного входа (`release-config.js`). */
loadReleaseConfig({ app });
const downloadHostAllowlist = parseDownloadHostAllowlist(
  process.env.ASTRAL_DOWNLOAD_HOSTS,
);

/* Анимации решает «Настройки», а не Windows (14.10.2026) — `apps/web/src/motion-preference.js`.
   Падение окна или видеочипа — ещё и отчётом об ошибке. */
app.commandLine.appendSwitch("force-prefers-no-reduced-motion");
capChromiumCache(app); // потолок HTTP-кэша Chromium (бюджет «Хранилища», 22.10)
const reportProcessGone = (details) => cloudAuth?.errors?.processGone(details);
const reportHang = (details) => cloudAuth?.errors?.hang(details);

/* Закрытая бета (docs/beta/beta-access.md): сборка с вшитым флагом ASTRAL_BETA_GATE.
   В разработке, песочнице и обычной сборке защита выключена, и ниже всё как раньше. */
const betaGate = betaGuard.configure({ app });
/* Ветка этого процесса — из beta\manifest.json установки (channels/branches.js): Astral / Astral Beta / Astral Alpha. */
const ownBranch = betaGate ? readOwnBranch() : null;
/* `Astral.exe --install-channel <ветка>` (зовёт установщик с сайта): поставить ветку рядом без окна и выйти. */
const installChannel = betaGate ? installChannelArgument(process.argv) : null;

app.setName(
  betaGate
    ? productNameFor(ownBranch)
    : demoMode
      ? "Astral Demo"
      : steamPreviewMode
        ? "Astral Steam Preview"
        : localDeveloperMode
          ? "Astral Developer"
          : "Astral",
);

if (demoMode || steamPreviewMode || localDeveloperMode) {
  const profileName = demoMode
    ? "Astral Demo"
    : steamPreviewMode
      ? "Astral Steam Preview"
      : "Astral Developer";
  app.setPath("userData", path.join(app.getPath("appData"), profileName));
}
/* Стенд проверок: своя папка данных окна (`ASTRAL_QA_USER_DATA`), как
   песочница игры у `ASTRAL_QA_GAME_ONLY`, — работы, хранилища окна и журнал
   стенда не смешиваются с данными человека. Принимается только путь со
   словом `sandbox`: в обычной работе переменная ничего не меняет. */
/* Какой модуль Rust загружен (или почему нет): первая строка, которую просят в тикете «медленно ставится». */
appLog.record({ level: rustStatus.available ? "info" : "warn", source: "native-rs", message: describeRustStatus() });
const qaUserData = String(process.env.ASTRAL_QA_USER_DATA || "").trim();
if (!betaGate && qaUserData && /sandbox/i.test(qaUserData)) app.setPath("userData", path.resolve(qaUserData));
/* Данные всех веток — одни, в %APPDATA%\Astral, что бы ни просили флаги окна и окружение: один вход,
   одна мастерская, ключ устройства и кэш ключа интерфейса общие (docs/beta/channels-and-roles.md).
   Прежняя папка беты «Astral Beta» один раз переезжает сюда. Замок единственного экземпляра
   считается по этой папке, поэтому и он общий: одновременно открыт один Astral. */
let userDataMigration = null;
if (betaGate) {
  userDataMigration = migrateLegacyUserData({ appData: app.getPath("appData") });
  app.setPath("userData", sharedUserDataPath(app.getPath("appData")));
  if (userDataMigration.reason !== "no-legacy")
    appLog.record({
      level: userDataMigration.moved ? "info" : "warn",
      source: "channels",
      message: `общая папка данных: ${userDataMigration.reason}${userDataMigration.error ? ` (${userDataMigration.error})` : ""}`,
    });
}
/*
 * Ветки Astral на одном ПК (`channels/`): вопрос о переключении при запуске другой ветки,
 * «Версии» в окне, «Доступ снят». Живёт и без обновителя; обновитель отдаёт ей ответы сервера.
 */
const channels = createDesktopChannels({ app, dialog, appWindow, raiseAppWindow, appLog, betaGate, ownChannel: ownBranch, broadcast: broadcastChannels });
/* Журнал фаз установки (каталог, растительность): во всех ветках; установка дольше минуты уходит в авто-ошибки только из альфы. */
configureInstallJournal({
  channel: ownBranch,
  log: (entry) => appLog.record(entry),
  report: (details) => cloudAuth?.errors?.capture(details, { source: "main" }),
});
/* Значок приложения (ТЗ 29.10.2026, п. 7): раскраска знака окну, панели задач и ярлыкам этого ПК (`app-icon.js`). */
const appIcon = lazyAppIcon({ app, BrowserWindow, nativeImage, shell, dirname, log: (level, message) => appLog.record({ level, source: "app-icon", message }) });
/* Закрытие окна (в трей или выход с вопросом посреди операции), автозапуск и версия. */
const presence = createAppPresence({
  app,
  dialog,
  Tray,
  Menu,
  nativeImage,
  iconPath: path.join(dirname, "tray-icon.png"),
  isBusy: () => workshopOperations.isBusy(),
  describeBusy: () => workshopOperations.describe()?.title, describeRebuild: () => workshopOperations.describe()?.dependent || null, downloads: () => activeOperations.size + (updates.getState?.()?.phase === "downloading" ? 1 : 0), sendCloseAsk: (win, payload) => !win?.isDestroyed?.() && (win.webContents.send(IPC.APP_CLOSE_ASK, payload), true), // закрытие во время скачивания спрашивает окно: docs/CLOSE-ASK.md
  gpuAtStart: () => gpuAtStart,
  /* Человек выбрал «Продолжить операцию»: ветка, на которую согласились переключиться, не запускается. */
  onQuitVetoed: () => channels.cancelPending(),
});
/*
 * Автообновление бета-лаунчера (`updates/index.js`): работает только в собранной
 * бета-сборке. Хелпер применяет обновление, пока лаунчер закрыт; перезапуск не
 * начинается, пока идёт установка или запись в игру.
 */
const updates = createUpdateService({
  app,
  getGuard: () =>
    import("./beta/guard.js")
      .then((module) => module.betaGuard ?? module.default ?? null)
      .catch(() => null),
  canRestart: () => !workshopOperations.isBusy() && activeOperations.size === 0, beforeLeave: () => rockstar.agent.stopForUpdate(), // агент режима Rockstar — тот же Astral.exe: ему выйти до замены app
  broadcast: broadcastUpdates,
  log: (level, message) => appLog.record({ level, source: "updates", message }),
  registerLogSource: (source) => appLog.registerSource(source),
  channels,
});
void import("./hibernation.js").then(({ createDesktopHibernation }) => createDesktopHibernation({ IPC, handleIpc, trusted, windowAttention, appLog, presence, workshopOperations, activeOperations, updates, cloudAuth: () => cloudAuth, channel: ownBranch })); // спячка окна
/* Видеокарта окна — до готовности приложения (`startup-guards.js`). */
const gpuAtStart = applyGpuPreference(app);

const nativeContext = () => ({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  projectRoot,
  /* Ход установки патча хостом — в полосу записи в игру. Вне рамки замок его
     не слушает, так что чтение архивов и сборка предпросмотров сюда ничего
     не шлют. */
  onProgress: (status) => workshopOperations.hostProgress(status),
});
const gtaSettingsPath = () =>
  path.join(
    app.getPath("documents"),
    "Rockstar Games",
    "GTA V",
    "settings.xml",
  );
const gtaSettingsStateDir = async () =>
  path.join(
    (await desktopStorage().installOptions()).stateDir,
    "settings-installer",
  );
const desktopStorage = () => (storageManager ||= createDesktopStorage({ app, session, workshopOperations, activeOperations, updates }));

async function withInstallState(input = {}) {
  const { stateDir } = await desktopStorage().installOptions();
  return { ...input, stateDir };
}

const safeInput = (value) => JSON.parse(JSON.stringify(value || {}));

const firstRun =
  process.argv.includes("--first-run") ||
  process.env.ASTRAL_FIRST_RUN === "1";
const registeredPreview =
  process.argv.includes("--registered-preview") ||
  process.env.ASTRAL_REGISTERED_PREVIEW === "1";
const localFirstRunQaMode = firstRun && !app.isPackaged;

/* Окно без интерфейса: с заставкой (`splash`), интерфейс — в `openAppWindow`. */
function createWindow({ splash = false } = {}) {
  const windowTitle = betaGate
    ? app.getName()
    : demoMode
    ? "Astral Demo"
    : steamPreviewMode
      ? "Astral Steam Preview"
      : localDeveloperMode
        ? "Astral Developer"
        : "Astral";
  const titlebarHeight = 40;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    resizable: true,
    maximizable: true,
    // Совпадает с --astral-void: окно показывает этот цвет до первой
    // отрисовки интерфейса, и синеватый чёрный читался как синий экран.
    backgroundColor: "#050505",
    title: windowTitle,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "rgba(0, 0, 0, 0)",
      symbolColor: "#ffffff",
      height: titlebarHeight,
    },
    webPreferences: {
      preload: path.join(dirname, "../dist/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Явно: скрытое окно обязано притормаживать (см. window-attention.js).
      backgroundThrottling: true,
      additionalArguments: [
        `--astral-ipc-nonce=${ipcNonce}`,
        ...(demoMode ? ["--astral-demo=1"] : []),
        ...(localDeveloperMode ? ["--astral-local-developer=1"] : []),
        ...(localFirstRunQaMode ? ["--astral-local-first-run-qa=1"] : []),
        ...(process.env.ASTRAL_ADS_ENABLED === "1" ? ["--astral-ads=1"] : []),
      ],
    },
  });
  appIcon.applyToWindow(win);
  windowAttention.watch(win);
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle(windowTitle);
  });
  presence.watch(win);
  win.webContents.on("did-finish-load", () => {
    /* Заставка (data:) — без хранилища и без ссылки: их получит интерфейс. */
    if (win.webContents.getURL().startsWith("data:")) return;
    win.setTitle(windowTitle);
    void win.webContents
      .executeJavaScript('window.localStorage.getItem("modovik-theme")')
      .then((theme) => applyTitlebarTheme(win, theme))
      .catch(() => {});
    const waiting = pendingDeepLink();
    if (waiting) {
      win.webContents.send(IPC.DEEP_LINK, waiting);
    }
  });
  if (splash) void win.loadURL(SPLASH_URL);
  return win;
}

/* Интерфейс в окно. Упакованная сборка ждёт локальный API (`localWebUrl`). */
function openAppWindow(win) {
  const webUrl = app.isPackaged
    ? localWebUrl
    : (process.env.MODOVIK_WEB_URL || "http://127.0.0.1:5173").replace(
        /\/$/,
        "",
      );
  bindRenderer(win.webContents, webUrl);
  cancelPendingLoginWhenWindowReturns(win, cloudAuth);
  const launchQuery = demoMode
    ? "?demo=1"
    : steamPreviewMode
      ? "?qa=steam&fresh=1"
      : localDeveloperMode
        ? "?developer=local"
        : firstRun
          ? `?onboarding=1&fresh=1${localFirstRunQaMode ? "&qa-auth=local" : ""}`
          : registeredPreview
            ? "?preview=after-registration"
            : "";
  const url = `${webUrl}/app${launchQuery}`;
  guardWindow(win, dialog, () => void win.loadURL(url), reportProcessGone, () => presence.language(), reportHang);
  return loadAppWindow(win, {
    url,
    origin: webUrl,
    onFailed: (reason) => showStartupFailure({ dialog, app, kind: "open", reason, log: (entry) => appLog.record(entry) }),
  });
}

function registerIpc() {
  onIpc(IPC.SET_TITLEBAR_THEME, (event, value) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    applyTitlebarTheme(win, value);
  });
  registerDesktopAuthIPC({ IPC, handleIpc, trusted, auth: cloudAuth, dialog });
  startupRecovery.register({ IPC, handleIpc, trusted });
  windowAttention.register({ handleIpc, trusted });
  /*
   * Все каналы Мастерской регистрируются через замок: он сам знает, какие из
   * них пишут в файлы игры (список — в `workshop-operations.js`), и такие
   * идут в рамке — с полосой в окне, с запретом на вторую операцию и с
   * вопросом при закрытии окна. Обычные каналы проходят как были.
   */
  const guardedIpc = guardGameWrites({
    IPC,
    handleIpc,
    operations: workshopOperations,
  });
  /* Общий набор зависимостей каналов мастерской: у всех вынесенных модулей
     одна и та же обвязка проверок, хранилища и замка записи в игру,
     различаются только предохранители. */
  const workshopDeps = {
    IPC,
    handleIpc: guardedIpc,
    trusted,
    safeInput,
    nativeContext,
    operations: workshopOperations,
    installOptions: () => desktopStorage().installOptions(),
    trimBuildMemory: () => desktopStorage().trimBuildMemory(),
    /* Подпись каталога и хосты пакетов — вещи каталога в мастерской одежды
       скачиваются тем же доверенным путём, что и при установке. */
    catalogPackages: () => ({
      publicKey: catalogPublicKey,
      allowedHosts:
        app.isPackaged && !localDevelopmentBuild ? downloadHostAllowlist : null,
      allowInsecureLocalhost: !app.isPackaged || localDevelopmentBuild,
    }),
  };
  rockstar.register({ trusted, safeInput, dialog, operations: workshopOperations });
  registerAppPresenceIpc({ IPC, handleIpc, trusted, presence });
  updates.registerIpc({ IPC, handleIpc, trusted });
  channels.registerIpc({ IPC, handleIpc, trusted });
  registerDesktopShellIpc({
    IPC,
    handleIpc,
    trusted,
    dialog,
    shell,
    clipboard,
  });
  registerAppIconIpc({ IPC, handleIpc, trusted, appIcon });
  registerSystemFontsIpc({ IPC, handleIpc, trusted });
  const { recoverLibraryRemoval } = registerInstallStateIpc({
    IPC,
    handleIpc,
    handleGameWrite: guardedIpc,
    trusted,
    safeInput,
    withInstallState,
    installOptions: () => desktopStorage().installOptions(),
    nativeContext,
    gtaSettingsPath,
    gtaSettingsStateDir,
    activeOperations,
    operations: workshopOperations,
    findGame,
    rockstarDelivery: rockstar.delivery,
    /* Фоновая уборка кэша уступает человеку, игре, записи и обновлению (`housekeeping-gate.js`). */
    quiet: {
      systemIdleMs: () => powerMonitor.getSystemIdleTime() * 1000,
      attention: () => windowAttention.current(),
      updatesBusy: () => ["downloading", "applying"].includes(updates.getState().phase),
    },
  });
  const { recoverVanillaSessions } = registerVanillaGuardIpc({
    IPC,
    handleIpc,
    trusted,
    safeInput,
    shell,
    withInstallState,
    findGame,
    gameProcessRunning,
    vanillaWatchers,
    broadcastVanillaStatus,
  });
  registerStorageIpc({
    IPC,
    handleIpc,
    trusted,
    desktopStorage,
    dialog,
    shell,
    safeInput,
  });
  /* Мастерская, публикация и установки — после окна и по первому вызову (`deferred-ipc.js`). */
  const registerDeferred = () =>
    import("./deferred-ipc.js").then(({ createDeferredIpc }) =>
      createDeferredIpc({
        settleIpc,
        IPC,
        app,
        handleIpc,
        guardedIpc,
        trusted,
        safeInput,
        workshopDeps,
        desktopStorage,
        dialog,
        shell,
        fs,
        findGame,
        gameProcessRunning,
        legacyRuntimeGuard,
        nativeContext,
        callNativeEngine,
        discoverGames,
        clothingShots,
        workshopOperations,
        presence,
        rockstar,
        catalogPublicKey,
        activeOperations,
        downloadHostAllowlist,
        localDevelopmentBuild,
        gtaSettingsPath,
        gtaSettingsStateDir,
        broadcastWorkshopProgress,
        broadcastOptimizationProgress,
      }),
    );
  return { recoverVanillaSessions, recoverLibraryRemoval, registerDeferred };
}

if (process.argv.includes("--rockstar-agent") ? (await (await import("./rockstar-mode/agent-entry.js")).runAgentProcess({ app, projectRoot }), true) : await (await import("./elevation.js")).takeOverElevated(app)) await new Promise(() => {}); // агент режима Rockstar (без окна, до прав, замка и беты) или запуск от имени администратора
/* Замок общий для всех веток (он по userData): второй запуск другой ветки передаёт первому, кто он. */
const hasLock = app.requestSingleInstanceLock(channels.lockData());
if (!hasLock) app.quit();
else {
  app.on("second-instance", (_event, argv, _workingDirectory, additionalData) => {
    if (channels.handleSecondInstance({ argv, additionalData })) return;
    const incomingDeepLink = deepLinkFromArgs(argv);
    if (incomingDeepLink) {
      dispatchDeepLink(incomingDeepLink);
      return;
    }
    raiseAppWindow();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    dispatchDeepLink(url);
  });
  app.whenReady().then(async () => {
    guardStartup(app, reportProcessGone, () => workshopOperations.describe()?.title || "", Menu, reportHang);
    /* Данные записала более новая ветка — окно «данные новее», запуск стоит: ничего не читаем и не пишем. */
    if (!installChannel && (await channels.blockIfDataNewer())) return;
    /* Скачанное обновление готово: хелпер покажет экран обновления, а лаунчер выйдет, не открывая окна. */
    if (!installChannel && (await updates.applyOnStart())) return;
    try {
      registerAstralProtocol();
      /* Потолок записи из «Хранилища» действует с первой установки, не только после открытия панели. */
      await desktopStorage().applyStoredWriteLimit().catch(() => {});
      /* Бета: до подъёма сервера — проверка доступа и интерфейса (pak; файлы расшифровываются при выдаче окну, beta/web-bundle.js).
         Закрылся лаунчер (самоудаление, экран ошибки, «Выйти») — больше ничего не поднимаем. */
      let betaWebLoading = null;
      let shellToken = "";
      if (betaGate) {
        const unlocked = await betaGuard.start({ app, safeStorage, dialog, shell, BrowserWindow, powerMonitor, log: (entry) => appLog.record({ source: "beta", ...entry }) });
        if (!unlocked.ok) return;
        if (installChannel) return void app.exit(await updates.installChannelFromCli(installChannel));
        /* Проверка pak идёт в потоке (beta/pak-scan.js) и не ждёт API: импорт сервера (~0,6 с) начинается сразу (холодный старт 31.10.2026). */
        betaWebLoading = betaGuard.loadWeb();
        shellToken = randomBytes(24).toString("base64url");
      }
      /* API начинает подниматься до окна: импорт идёт, пока окно создаётся (и, в бете, пока проверяется pak). */
      const servicesStarted = startPackagedServices(app, { betaWeb: betaWebLoading, shellToken });
      servicesStarted.catch(() => {}); // ошибку ждёт `await servicesStarted` ниже
      /* Pak не открылся: окно ошибки уже показано, ничего не поднимаем. */
      if (betaWebLoading && !(await betaWebLoading)) return void servicesStarted.then((started) => started.server?.close()).catch(() => {});
      /* Окно сразу, с заставкой: пока поднимается локальный API, оно уже на экране. */
      const win = createWindow({ splash: app.isPackaged });
      appIcon.restoreLater();
      const packagedServices = await servicesStarted;
      localApiServer = packagedServices.server;
      localWebUrl = packagedServices.webUrl;
      /* Ключ беты и токен канала данных движка в запросах окна (`engine-window-wiring.js`). */
      void wireWindowRequests({ session, shellToken, localWebUrl, installOptions: () => desktopStorage().installOptions() });
      localDevelopmentBuild = isLocalDesktopBuild({ app });
      cloudAuth = createElectronDesktopAuth({
        app,
        safeStorage,
        shell,
        localAgentOrigin: !app.isPackaged
          ? process.env.ASTRAL_LOCAL_AGENT_ORIGIN || "http://127.0.0.1:4174"
          : localDevelopmentBuild
            ? localWebUrl
            : "",
        onCatalogUpdate: broadcastCloudCatalog,
      });
      const { recoverVanillaSessions, recoverLibraryRemoval, registerDeferred } =
        registerIpc();
      /* Скорость 12.10: восстановление после сбоя (разбор состояния
         установок — сотни миллисекунд) больше не держит окно — оно грузится
         одновременно, а его вызовы ждут конца восстановления (`holdIpc`). */
      holdIpc();
      /* Каналы ещё не подключённых модулей ждут их, окно — нет (задача 6).
         Модули грузятся по первому вызову такого канала или когда окно уже
         поднялось: не раньше — иначе их загрузка заняла бы главный поток
         как раз на первых вызовах ядра (вход, состояние установок). */
      const loadDeferred = lazyWorkshopIpc({ registerDeferred, expectIpc, settleIpc, IPC, appLog });
      openAppWindow(win).then(() => setTimeout(loadDeferred, 1200));
      void updates.start(); void import("./engine-file-check.js").then(({ checkEngineFile }) => checkEngineFile({ ...nativeContext(), log: (entry) => appLog.record(entry) })).catch(() => {}); void import("./game-crash/boot.js").then(({ bootGameCrashJournal }) => bootGameCrashJournal({ app, appLog, discoverGames, installOptions: () => desktopStorage().installOptions() })); void Promise.all([import("./carriers-start-guard.js"), import("./install-state-ipc.js")]).then(([{ bootCarrierFocusGuard }, { guardCarriersAllGames }]) => bootCarrierFocusGuard({ app, run: guardCarriersAllGames, busy: () => activeOperations.size > 0 || workshopOperations.isBusy(), gameRunning: gameProcessRunning, log: (entry) => appLog.record(entry) })).catch(() => {}); void import("./clothing-registration-boot.js").then(({ bootClothingRegistrationKeeper }) => bootClothingRegistrationKeeper({ app, appLog, discoverGames, installOptions: () => desktopStorage().installOptions(), busy: () => activeOperations.size > 0 || workshopOperations.isBusy(), gameRunning: gameProcessRunning, remember: (result) => startupRecovery.recordClothing(result) })); // журнал падений игры (docs/GAME-CRASH-LOG.md); страж регистрации DLC одежды (clothing-registration-heal.js)
      setTimeout(loadDeferred, 6000);
      void import("./clothing-index-warm.js").then(({ startMainClothingIndexWarmup }) => startMainClothingIndexWarmup({ discoverGames, installOptions: () => desktopStorage().installOptions(), busy: () => activeOperations.size > 0 || workshopOperations.isBusy(), gameRunning: () => gameProcessRunning({ executable: "GTA5.exe" }), nativeContext, record: (entry) => appLog.record({ source: "clothing-index", ...entry }) })); // оглавление одежды игры заранее, в потоке чтения (docs/perf/wear-index.md)
      try {
        startupRecovery.recordLibrary(await recoverLibraryRemoval());
      } finally {
        releaseIpc();
      }
      startupRecovery.recordVanilla(recoverVanillaSessions());
      scheduleRestorePointsAdoption({ adopt: () => desktopStorage().startupUpkeep(), log: (entry) => appLog.record({ source: "storage", ...entry }) }); // точки с C: — в папку кэша
      app.on("activate", () => {
        if (!appWindow()) openAppWindow(createWindow());
      });
    } catch (error) {
      console.error("Astral startup failed", error);
      /* Срыв запуска — главное, что просят приложить к тикету (Т-153). */
      appLog.start({ userData: app.getPath("userData"), appVersion: app.getVersion() }).record({ level: "error", source: "main", message: `Запуск не удался: ${error?.message || error}`, detail: error?.stack || "" });
      showStartupFailure({ dialog, app, kind: "start", reason: error?.message }); // шесть языков и причина (startup-failure-words.js); запись в журнал сделана выше
      app.quit();
    }
  });
}

app.on("before-quit", () => {
  ipcCrashGuard.stop();
  betaGuard.stop();
  vanillaWatchers.clear();
  localApiServer?.close();
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
