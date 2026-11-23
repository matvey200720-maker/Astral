import { cacheHousekeepingRunning, compactRestorePointsNow } from "./cache-housekeeping.js";
import { restorePointsGuard } from "./restore-points-move.js";
import { createStorageManager } from "./storage-manager.js";
import { defaultCacheRootFor, legacyStateRootFor } from "./qa-isolation.js";

export const CHROMIUM_CACHE_BYTES = 256 * 1024 * 1024;

export function capChromiumCache(app) {
  app.commandLine.appendSwitch("disk-cache-size", String(CHROMIUM_CACHE_BYTES));
}

// Папки по порядку: имя ключа и как он считается от пути данных. К app.getPath обращаемся ровно пять раз
// за создание — эта таблица берёт первые четыре (три раза «userData» и один раз «home»).
const ROOT_BUILDERS = [
  ["configRoot", (userData) => userData()],
  ["defaultCacheRoot", (userData) => defaultCacheRootFor({ userData: userData() })],
  ["legacyStateRoot", (userData, app) => legacyStateRootFor({ userData: userData(), home: app.getPath("home") })],
];

function storageRoots(app) {
  const userData = () => app.getPath("userData");
  return Object.fromEntries(ROOT_BUILDERS.map(([name, build]) => [name, build(userData, app)]));
}

// Занятость читается при каждом обращении к замку, а не при создании хранилища.
function writingProbe(workshopOperations, activeOperations) {
  const checks = [() => workshopOperations.isBusy(), () => activeOperations.size > 0, () => cacheHousekeepingRunning()];
  return () => {
    let verdict;
    for (const check of checks) {
      verdict = check();
      if (verdict) break;
    }
    return verdict;
  };
}

function storageChores(session, updates) {
  const chromium = () => session.defaultSession;
  return {
    async clearChromiumCache() {
      await chromium().clearCache();
      await chromium().clearCodeCaches?.({});
    },
    async updatesPlaces() {
      const places = await updates.leftoverPlaces?.();
      return places || null;
    },
    compactPoints(root) {
      return compactRestorePointsNow({ root });
    },
  };
}

/* События «Быстрой установки» — всем окнам. Рассылка грузится по вызову: с ней приходит Electron, а хранилище собирают и без него. */
const announceFastInstall = (event) => {
  void import("./broadcast.js").then(({ broadcastFastInstall }) => broadcastFastInstall(event)).catch(() => {});
};

export function createDesktopStorage(parts) {
  const { app, session, workshopOperations, activeOperations, updates } = parts;
  const roots = storageRoots(app);
  const pointsGuard = restorePointsGuard(writingProbe(workshopOperations, activeOperations));
  const userDataRoot = app.getPath("userData");
  const manager = createStorageManager({ ...roots, pointsGuard, userDataRoot, announceFastInstall, ...storageChores(session, updates) });
  /* Установка из мастерской началась — хранилище предлагает «Быструю установку», если ещё не предлагало. */
  workshopOperations.watchInstallStart?.(() => manager.offerFastInstall());
  return manager;
}
