import { qaDesktopBridge } from "./qa-desktop-bridge.js";
import { API_ROUTES } from "@modovik/contracts/api";
import { downloadsAcceleratedNow } from "./features/downloads/accelerated.js";
import { tr } from "./locales/ui.js";
import { takeProjectPacks } from "./features/workshop/project-interiors-editor/project-pack-store.js";
import {
  gateWorkshopWrite,
  isWorkshopWriteMethod,
} from "./features/workshop/install-queue/write-gate.js";
import { engineModId, engineModIds } from "./features/library/engine-ids.js";

/* Окно знает мод каталога по UUID, движок — по id манифеста (slug): id,
   уходящие движку, переводятся здесь (`features/library/engine-ids.js`). */
const forEngine = (input) => {
  if (!input || typeof input !== "object") return input;
  const out = { ...input };
  if (typeof out.modId === "string") out.modId = engineModId(out.modId);
  if (Array.isArray(out.replaceModIds))
    out.replaceModIds = engineModIds(out.replaceModIds);
  /* Снять другие моды той же транзакцией (одиночная установка и пачка). */
  if (Array.isArray(out.removeModIds))
    out.removeModIds = engineModIds(out.removeModIds);
  if (Array.isArray(out.mods))
    out.mods = out.mods.map((item) =>
      typeof item === "string"
        ? engineModId(item)
        : item && typeof item.modId === "string"
          ? { ...item, modId: engineModId(item.modId) }
          : item,
    );
  return out;
};

let csrfToken = "";
let csrfRequest = null;

/*
 * Мост — через затвор записи мастерской (`write-gate.js`): `apply…` отменённой
 * работы не уходит в главный процесс, а первый прошедший отмечает, что запись
 * началась. Обёртка одна на объект моста, остальные его поля — как есть.
 *
 * Цель обёртки — свой пустой объект, а не сам мост: мост приложения заморожен
 * (`contextBridge`), и ловушка `get` над замороженной целью обязана отдавать
 * её же функцию, а не обёрнутую.
 */
const gatedBridges = new WeakMap();
function gatedBridge(bridge) {
  if (!bridge || typeof bridge !== "object") return bridge;
  let gated = gatedBridges.get(bridge);
  if (!gated) {
    gated = new Proxy(Object.create(null), {
      get(_, key) {
        const value = bridge[key];
        if (typeof value !== "function" || !isWorkshopWriteMethod(key))
          return value;
        return (...args) => gateWorkshopWrite(() => value.apply(bridge, args));
      },
      has: (_, key) => key in bridge,
    });
    gatedBridges.set(bridge, gated);
  }
  return gated;
}
const desktopBridge = () => gatedBridge(window.modovik || qaDesktopBridge);

/**
 * Есть ли под окном приложение Astral.
 *
 * Нужна там, где выбор между «показать действие» и «показать объяснение»
 * делается до нажатия: предлагать кнопку, которая заведомо ответит «только в
 * приложении», хуже, чем не предлагать её вовсе.
 */
export const hasDesktopBridge = () => Boolean(desktopBridge());

/**
 * Мост приложения для редакторов, которые зовут его напрямую.
 *
 * Студия звука ходит в главный процесс десятком методов, и оборачивать
 * каждый в свою функцию `api.js` значило бы переписать её же протокол во
 * второй раз. Но и брать `window.modovik` руками нельзя: тогда мимо редактора
 * проходит QA-заглушка (`?qa=isolated`), и разработчик не может открыть
 * редактор в браузере, чтобы посмотреть на него. Одна точка входа решает оба.
 */
export const desktopHost = () => desktopBridge();
const localQaAdminHeaders = () =>
  desktopBridge()?.localFirstRunQaMode
    ? { "X-Astral-Local-QA": "first-run-admin" }
    : {};

export function sanitizeDesktopErrorMessage(error) {
  const raw = String(error?.message || error || "");
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "")
    .replace(/^(?:(?:InstallBlockedError|Error):\s*)+/i, "")
    .replace(/\bmodovik\b/gi, "Astral")
    .trim();
}

function astralDesktopError(error) {
  const message = sanitizeDesktopErrorMessage(error);
  const clean = new Error(
    message || "Astral could not complete the operation.",
  );
  clean.name = error?.name || "Error";
  clean.code = error?.code;
  return clean;
}

async function callDesktop(operation) {
  try {
    return await operation();
  } catch (error) {
    throw astralDesktopError(error);
  }
}

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = fetch(`/api${API_ROUTES.session}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            payload.error || tr("Не удалось подготовить безопасное соединение"),
          );
        }
        csrfToken = payload.csrfToken || "";
        if (!csrfToken) {
          throw new Error("Сервер не вернул токен безопасности");
        }
        return csrfToken;
      })
      .finally(() => {
        csrfRequest = null;
      });
  }
  return csrfRequest;
}

export async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET") await ensureCsrfToken();
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...localQaAdminHeaders(),
      ...(method !== "GET" && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    /* Статус — для тех, кому важна причина отказа: 409 «задание уже
       взято» — не ошибка исполнителя, а соседа по очереди. */
    throw Object.assign(
      new Error(payload.error || tr("Не удалось выполнить запрос")),
      { status: response.status },
    );
  }

  if (response.status === 204) return { ok: true };
  const payload = await response.json();
  if (payload.csrfToken) csrfToken = payload.csrfToken;
  return payload;
}

export function saveWorkshopProjectCloud(project) {
  return api("/workshop/projects", {
    method: "POST",
    body: JSON.stringify({ project }),
  });
}

export function importWorkshopProjectCloud(code) {
  return api("/workshop/projects/import", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function uploadAdminTracerAsset(kind, file) {
  if (!(file instanceof Blob)) throw new Error("Выберите файл для загрузки.");
  const token = await ensureCsrfToken();
  const response = await fetch("/api/admin/tracer-assets", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-CSRF-Token": token,
      "X-Astral-Asset-Kind": kind,
      ...localQaAdminHeaders(),
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error || tr("Не удалось загрузить файл."));
  return payload;
}

export function preflightAdminTracer(input) {
  return api("/admin/tracers/preflight", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function publishAdminTracer(input) {
  return api("/admin/tracers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function preflightAdminMod(input) {
  return api("/admin/mods/preflight", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function publishAdminMod(input) {
  return api("/admin/mods", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getAdminInstallCapabilities() {
  return api("/admin/install-capabilities");
}

export function getAdminPackages() {
  return api("/admin/packages");
}

export async function detectInstallations() {
  const desktop = desktopBridge();
  if (desktop?.detectGames) {
    return desktop.detectGames();
  }
  return api("/system/installations");
}

/**
 * Шрифты, установленные на компьютере (ТЗ 23.10.2026, п. F): `[{ id, name }]`. Только в Astral Desktop — в браузере
 * пусто: окно сайта не читает шрифты системы.
 */
export async function listSystemFonts() {
  const desktop = desktopBridge();
  if (!desktop?.listSystemFonts) return [];
  const fonts = await desktop.listSystemFonts();
  return Array.isArray(fonts) ? fonts : [];
}

/** Файл установленного шрифта по номеру из списка: `{ name, extension, data: Uint8Array }`. */
export async function readSystemFont(id) {
  const desktop = desktopBridge();
  if (!desktop?.readSystemFont) throw new Error("Шрифты компьютера доступны только в приложении Astral.");
  return desktop.readSystemFont(id);
}

export async function chooseGameInstallation() {
  const desktop = desktopBridge();
  if (!desktop?.chooseGame)
    throw new Error("Выбор папки доступен только в приложении Astral.");
  return desktop.chooseGame();
}

export async function prepareGameInstallation(input) {
  const desktop = desktopBridge();
  if (!desktop?.prepareGame)
    throw new Error(
      "Автоматическая подготовка GTA V доступна только в приложении Astral.",
    );
  return desktop.prepareGame(input);
}

export async function getLocalInstallProfile() {
  return desktopBridge()?.getInstallProfile?.() || api("/profile");
}
/*
 * Что старт доделал за прошлый раз: прерванное удаление из «Библиотеки» и
 * сеанс игры без модов. Отдаётся один раз; в браузере отчитываться не о чем.
 */
export async function takeStartupRecovery() {
  const desktop = desktopBridge();
  if (!desktop?.getStartupRecovery) return { library: null, vanilla: [] };
  return callDesktop(() => desktop.getStartupRecovery());
}
/*
 * Стоит ли поставленное в игре на самом деле: сверка живого update.rpf с тем,
 * что Astral оставил последним. В браузере архива нет — ответ «неизвестно»,
 * и библиотека просто не показывает предупреждения.
 */
export async function getLibraryStatus(input) {
  const desktop = desktopBridge();
  if (!desktop?.getLibraryStatus)
    return { status: "unknown", reason: "no-desktop" };
  return desktop.getLibraryStatus(input);
}
/*
 * Корзина библиотеки. План ничего не пишет: он отвечает окну подтверждения,
 * что уйдёт из игры, что встанет обратно и что мешает. Удаление — одна
 * операция на всё выделенное, с рамкой «идёт запись в игру».
 */
export async function planLibraryRemoval(input) {
  const desktop = desktopBridge();
  if (!desktop?.planLibraryRemoval)
    throw new Error("Удаление доступно только в приложении Astral.");
  return callDesktop(() => desktop.planLibraryRemoval(forEngine(input)));
}
export async function removeFromLibrary(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeFromLibrary)
    throw new Error("Удаление доступно только в приложении Astral.");
  return callDesktop(() => desktop.removeFromLibrary(forEngine(input)));
}
/*
 * Новая версия работы встала: прежние версии той же работы уходят из стопки
 * точек отката. Без приложения делать нечего — и это не ошибка.
 */
export async function retirePreviousInstalls(input) {
  const desktop = desktopBridge();
  if (!desktop?.retirePreviousInstalls) return null;
  return callDesktop(() => desktop.retirePreviousInstalls(input));
}
/*
 * «Установить снова» после проверки файлов игры (задача 2 ТЗ 10.10.2026):
 * снятые моды и работы мастерской — одной операцией.
 */
export async function reinstallAfterRestore(input) {
  const desktop = desktopBridge();
  if (!desktop?.reinstallAfterRestore)
    throw new Error("Установка доступна только в приложении Astral.");
  return callDesktop(() => desktop.reinstallAfterRestore(input));
}
export async function planLocalPackage(input) {
  const desktop = desktopBridge();
  if (!desktop?.planPackage)
    throw new Error("Установка доступна только в приложении Astral.");
  return callDesktop(() => desktop.planPackage(input));
}
export async function installLocalPackage(input) {
  const desktop = desktopBridge();
  if (!desktop?.installPackage)
    throw new Error("Установка доступна только в приложении Astral.");
  return callDesktop(() => desktop.installPackage(input));
}
export async function installRemotePackage(input) {
  const desktop = desktopBridge();
  if (!desktop?.installRemotePackage)
    throw new Error("Установка доступна только в приложении Astral.");
  /* Настройка «ускоренной загрузки» идёт с каждой установкой: главный процесс
     не должен помнить её сам (features/downloads/accelerated.js). */
  return callDesktop(() =>
    desktop.installRemotePackage({
      accelerated: downloadsAcceleratedNow(),
      ...forEngine(input),
    }),
  );
}
/*
 * Пачка пакетов одной транзакцией (этап 2, ТЗ ведущей 10.11.2026; движок — ветка Р2 Хелпера 27): несколько пакетов и снятие других модов, отказ ничего не меняет.
 * `input = { operationId, targetId, name, packages: [{ manifest, baseUrl, replaceModIds?, origin? }], removeModIds?, accelerated? }`; ход — прежним событием
 * прогресса с `operationId`. Id модов каталога переводятся в id движка здесь, как у одиночной установки.
 */
export async function installRemotePackages(input) {
  const desktop = desktopBridge();
  if (!desktop?.installRemotePackages)
    throw new Error("Установка доступна только в приложении Astral.");
  const packages = Array.isArray(input?.packages)
    ? input.packages.map((item) => forEngine(item))
    : [];
  return callDesktop(() =>
    desktop.installRemotePackages({
      accelerated: downloadsAcceleratedNow(),
      ...forEngine(input),
      packages,
    }),
  );
}
/* Загрузка наперёд (бета 15.10): при «Ускоренной загрузке» очередь качает
   следующий мод, пока текущий ставится. Без моста окна — ничего. */
export async function prefetchPackage(input) {
  const desktop = desktopBridge();
  if (!desktop?.prefetchPackage) return null;
  return callDesktop(() => desktop.prefetchPackage(input));
}
/* Переключение «ускоренной загрузки» на ходу: идущая установка тоже его
   примет (предел линий перечитывается перед каждым файлом). Без моста окна
   выбор остаётся здесь и уйдёт с первой установкой. */
export async function setDownloadsAccelerated(enabled) {
  const desktop = desktopBridge();
  if (!desktop?.setDownloadsAccelerated)
    return { accelerated: enabled === true };
  return callDesktop(() =>
    desktop.setDownloadsAccelerated({ enabled: enabled === true }),
  );
}
/* `level` — `choice` (по умолчанию), `press` или `background` (прогрев наведением, снимки плиток): очередь выдачи под пределом сервера в Desktop (`grant-pacer.js`). */
export async function getCloudDownloadGrant(modID, level) {
  const desktop = desktopBridge();
  if (!desktop?.getCloudDownloadGrant)
    throw new Error("Загрузка доступна только в приложении Astral.");
  return level ? desktop.getCloudDownloadGrant(modID, level) : desktop.getCloudDownloadGrant(modID);
}
export async function getCloudRating(modID) {
  const desktop = desktopBridge();
  if (!desktop?.getCloudRating)
    throw new Error("Оценки доступны только в Astral Desktop.");
  return desktop.getCloudRating(modID);
}
export async function setCloudRating(modId, value) {
  const desktop = desktopBridge();
  if (!desktop?.setCloudRating)
    throw new Error("Оценки доступны только в Astral Desktop.");
  return desktop.setCloudRating({ modId, value });
}
export async function cancelLocalOperation(operationId) {
  const desktop = desktopBridge();
  if (!desktop?.cancelOperation) return { cancelled: false };
  return callDesktop(() => desktop.cancelOperation(operationId));
}
/**
 * Установленные редуксы на новом пути (dlc + слой) и действия над ними: `{ action: "list" }` → `[{ targetId, modId, state, bytes }]`;
 * `{ action: "disable" | "enable" | "free", modId, targetId? }`. Вне Astral Desktop (браузер) — `null`.
 */
export async function reduxLayerCall(input) {
  const desktop = desktopBridge();
  if (!desktop?.reduxLayer) return null;
  return callDesktop(() => desktop.reduxLayer(input));
}
export function onLocalInstallProgress(listener) {
  return desktopBridge()?.onInstallProgress?.(listener) || (() => {});
}
export async function chooseWorkshopResourceRoot() {
  const desktop = desktopBridge();
  if (!desktop?.chooseWorkshopResourceRoot) {
    throw new Error("Прямое применение доступно только в приложении Astral.");
  }
  return callDesktop(() => desktop.chooseWorkshopResourceRoot());
}
export async function planWorkshopResource(input) {
  const desktop = desktopBridge();
  if (!desktop?.planWorkshopResource) {
    throw new Error(
      "Проверка FiveM resource доступна только в Astral Desktop.",
    );
  }
  return callDesktop(() => desktop.planWorkshopResource(input));
}
export async function applyWorkshopResource(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyWorkshopResource) {
    throw new Error(
      "Применение FiveM resource доступно только в Astral Desktop.",
    );
  }
  return callDesktop(() => desktop.applyWorkshopResource(input));
}
export async function rollbackWorkshopResource(input) {
  const desktop = desktopBridge();
  if (!desktop?.rollbackWorkshopResource) {
    throw new Error("Откат FiveM resource доступен только в Astral Desktop.");
  }
  return callDesktop(() => desktop.rollbackWorkshopResource(input));
}
export async function openWorkshopPath(input) {
  const desktop = desktopBridge();
  if (!desktop?.openWorkshopPath) {
    throw new Error("Открытие папки доступно только в Astral Desktop.");
  }
  return callDesktop(() => desktop.openWorkshopPath(input));
}
export async function openWorkshopProjectFolder(input) {
  const desktop = desktopBridge();
  if (!desktop?.openWorkshopProjectFolder) {
    throw new Error("Открытие папки проекта доступно только в Astral Desktop.");
  }
  return callDesktop(() => desktop.openWorkshopProjectFolder(input));
}
export function onWorkshopProgress(listener) {
  return desktopBridge()?.onWorkshopProgress?.(listener) || (() => {});
}

/*
 * Полоса Мастерской: одна операция на всё окно, потому что пишет она в один
 * архив игры. Подписка живёт отдельно от `onWorkshopProgress` — та про
 * очередь FiveM resource.
 */
export function onWorkshopInstallProgress(listener) {
  return desktopBridge()?.onWorkshopInstallProgress?.(listener) || (() => {});
}
export async function uninstallLocalPackage(input) {
  const desktop = desktopBridge();
  if (!desktop?.uninstallPackage)
    throw new Error("Удаление доступно только в приложении Astral.");
  return callDesktop(() => desktop.uninstallPackage(forEngine(input)));
}
export async function resetLocalTarget(input) {
  const desktop = desktopBridge();
  if (!desktop?.resetTarget)
    throw new Error("Сброс доступен только в приложении Astral.");
  return desktop.resetTarget(input);
}
/*
 * Сборка человека (задача 1 ТЗ 07.10.2026): установка отказала вопросом
 * «оставить своё или заменить». Список спорных файлов — отдельным вопросом
 * (через Electron ошибка доходит одной строкой), решение — на каждый файл.
 */
export async function readForeignConflicts() {
  const desktop = desktopBridge();
  if (!desktop?.readForeignConflicts) return null;
  return callDesktop(() => desktop.readForeignConflicts());
}
export async function setForeignChoices(input) {
  const desktop = desktopBridge();
  if (!desktop?.setForeignChoices)
    throw new Error(
      "Решение о файлах игры доступно только в приложении Astral.",
    );
  return callDesktop(() => desktop.setForeignChoices(input));
}
export async function restoreOriginalLocalTarget(input) {
  const desktop = desktopBridge();
  if (desktop?.restoreOriginalTarget) {
    return desktop.restoreOriginalTarget(input);
  }
  if (desktop?.resetTarget) {
    return desktop.resetTarget({ ...input, mode: "restore-original" });
  }
  throw new Error(
    "Восстановление оригинальных файлов доступно только в приложении Astral.",
  );
}
export async function auditLocalTarget(input) {
  const desktop = desktopBridge();
  if (!desktop?.auditTarget)
    return { status: "not-configured", checked: 0, healthy: 0, drift: [] };
  return desktop.auditTarget(input);
}
export async function repairLocalTarget(input) {
  const desktop = desktopBridge();
  if (!desktop?.repairTarget)
    throw new Error("Восстановление доступно только в приложении Astral.");
  return desktop.repairTarget(input);
}
/** Перенос стоящих модов в контейнеры RP: что предложить (ничего не пишет). Вне приложения или без выключателя — «не нужно». */
export async function getRpMigrateStatus(input) {
  const desktop = desktopBridge();
  if (!desktop?.rpMigrateStatus) return { enabled: false, needed: false };
  return desktop.rpMigrateStatus(input);
}
/** «Где играю» (настройки → GTA V): `{ place, active, available }`; вне приложения — `null` (строки нет). */
export async function getRpPlace() {
  const desktop = desktopBridge();
  if (!desktop?.getRpPlace) return null;
  return desktop.getRpPlace();
}
/** Выбрать «rp», «majestic» или «story»: ответ — то же состояние и `applied` (`now`, `restart`, `none`). */
export async function setRpPlace(place) {
  const desktop = desktopBridge();
  if (!desktop?.setRpPlace) throw new Error("Выбор доступен только в приложении Astral.");
  return desktop.setRpPlace(place);
}
/** Запуск переноса по слову человека; `operationId` — чтобы отменить тем же `cancelOperation`, что установку. */
export async function runRpMigrate(input) {
  const desktop = desktopBridge();
  if (!desktop?.rpMigrateRun)
    throw new Error("Перенос доступен только в приложении Astral.");
  return desktop.rpMigrateRun(input);
}
export async function listLocalRestorePoints(input) {
  const desktop = desktopBridge();
  if (!desktop?.listRestorePoints) return [];
  return desktop.listRestorePoints(input);
}
export async function restoreLocalPoint(input) {
  const desktop = desktopBridge();
  if (!desktop?.restorePoint)
    throw new Error(
      "История восстановления доступна только в приложении Astral.",
    );
  return desktop.restorePoint(input);
}
export async function getVanillaStatus(input) {
  const desktop = desktopBridge();
  if (!desktop?.getVanillaStatus)
    return {
      targetId: input?.targetId,
      active: false,
      phase: "unavailable",
      moved: [],
    };
  return desktop.getVanillaStatus(input);
}
export async function launchVanilla(input) {
  const desktop = desktopBridge();
  if (!desktop?.launchVanilla)
    throw new Error("Vanilla Guard доступен только в приложении Astral.");
  return desktop.launchVanilla(input);
}
export async function launchGame(input) {
  const desktop = desktopBridge();
  if (!desktop?.launchGame)
    throw new Error("Запуск GTA V доступен только в приложении Astral.");
  return desktop.launchGame(input);
}
export async function restoreVanilla(input) {
  const desktop = desktopBridge();
  if (!desktop?.restoreVanilla)
    throw new Error("Vanilla Guard доступен только в приложении Astral.");
  return desktop.restoreVanilla(input);
}
export function onVanillaStatus(listener) {
  return desktopBridge()?.onVanillaStatus?.(listener) || (() => {});
}
/*
 * Моды в копию из Rockstar Games Launcher (задача 7): способ доставки у
 * копии, вторая папка игры. В браузере способов нет — `null`.
 */
export async function getRockstarDelivery(input) {
  const desktop = desktopBridge();
  if (!desktop?.getRockstarDelivery) return null;
  return desktop.getRockstarDelivery(input);
}
export async function setRockstarDelivery(input) {
  const desktop = desktopBridge();
  if (!desktop?.setRockstarDelivery)
    throw new Error(
      "Способ доставки модов меняется только в приложении Astral.",
    );
  return desktop.setRockstarDelivery(input);
}
export async function chooseRockstarCopyFolder() {
  const desktop = desktopBridge();
  if (!desktop?.chooseRockstarCopyFolder) return null;
  return desktop.chooseRockstarCopyFolder();
}
export async function createRockstarCopy(input) {
  const desktop = desktopBridge();
  if (!desktop?.createRockstarCopy)
    throw new Error("Вторая папка игры собирается только в приложении Astral.");
  return desktop.createRockstarCopy(input);
}
export async function syncRockstarCopy(input) {
  const desktop = desktopBridge();
  if (!desktop?.syncRockstarCopy)
    throw new Error(
      "Вторая папка игры обновляется только в приложении Astral.",
    );
  return desktop.syncRockstarCopy(input);
}
/* Режим Rockstar (05.11.2026): пересборка протухшего образа, ручные кнопки, журнал режима. */
export async function rebuildRockstarMode(input) {
  const desktop = desktopBridge();
  if (!desktop?.rebuildRockstarMode)
    throw new Error("Режим Rockstar пересобирается только в приложении Astral.");
  return desktop.rebuildRockstarMode(input);
}
export async function armRockstarMode(input) {
  const desktop = desktopBridge();
  if (!desktop?.armRockstarMode)
    throw new Error("Режим Rockstar работает только в приложении Astral.");
  return desktop.armRockstarMode(input);
}
export async function disarmRockstarMode(input) {
  const desktop = desktopBridge();
  if (!desktop?.disarmRockstarMode)
    throw new Error("Режим Rockstar работает только в приложении Astral.");
  return desktop.disarmRockstarMode(input);
}
export async function getRockstarModeLog(input) {
  const desktop = desktopBridge();
  if (!desktop?.getRockstarModeLog) return [];
  return desktop.getRockstarModeLog(input);
}
export async function deleteRockstarCopy(input) {
  const desktop = desktopBridge();
  if (!desktop?.deleteRockstarCopy)
    throw new Error("Вторая папка игры удаляется только в приложении Astral.");
  return desktop.deleteRockstarCopy(input);
}
export function onRockstarDelivery(listener) {
  return desktopBridge()?.onRockstarDelivery?.(listener) || (() => {});
}
export function onRockstarCopyProgress(listener) {
  return desktopBridge()?.onRockstarCopyProgress?.(listener) || (() => {});
}
export async function getNativeEngineHealth() {
  const desktop = desktopBridge();
  if (!desktop?.nativeHealth)
    return { available: false, capabilities: [], tools: {} };
  return desktop.nativeHealth();
}
export async function convertNativeModel(input) {
  const desktop = desktopBridge();
  if (!desktop?.convertModel)
    throw new Error(
      "Model conversion is available only in the Astral desktop app.",
    );
  return desktop.convertModel(input);
}
export async function extractNativeTextures(input) {
  const desktop = desktopBridge();
  if (!desktop?.extractTextures)
    throw new Error(
      "Texture Toolkit is available only in the Astral desktop app.",
    );
  return desktop.extractTextures(input);
}
export async function renameNativeTexture(input) {
  const desktop = desktopBridge();
  if (!desktop?.renameTexture)
    throw new Error(
      "Texture Toolkit is available only in the Astral desktop app.",
    );
  return desktop.renameTexture(input);
}
export async function validateNativeRpfPatch(input) {
  const desktop = desktopBridge();
  if (!desktop?.validateRpfPatch)
    throw new Error(
      "RPF validation is available only in the Astral desktop app.",
    );
  return desktop.validateRpfPatch(input);
}
export async function installNativeRpfPatch(input) {
  const desktop = desktopBridge();
  if (!desktop?.installRpfPatch)
    throw new Error(
      "RPF installation is available only in the Astral desktop app.",
    );
  return desktop.installRpfPatch(input);
}
export async function restoreNativeRpfPoint(input) {
  const desktop = desktopBridge();
  if (!desktop?.restoreRpfPoint)
    throw new Error("RPF restore is available only in the Astral desktop app.");
  return desktop.restoreRpfPoint(input);
}
export async function planReticleCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planReticle)
    throw new Error("Применение прицела доступно только в Astral Desktop.");
  return desktop.planReticle(input);
}
export async function applyReticleCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyReticle)
    throw new Error("Применение прицела доступно только в Astral Desktop.");
  return desktop.applyReticle(input);
}
export async function planMinimapCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planMinimap)
    throw new Error("Применение мини-карты доступно только в Astral Desktop.");
  return desktop.planMinimap(input);
}
/*
 * Большая карта.
 *
 * Чтение плиток — единственный вызов карты, у которого отсутствие рабочего
 * стола не ошибка: в браузере редактор рисует схему штата и продолжает
 * работать. Всё, что пишет в игру, без Astral Desktop честно отказывает.
 */
/** Умеет ли эта сборка писать карту в игру. Браузер — нет, и это не ошибка. */
export function worldMapApplySupported() {
  return Boolean(desktopBridge()?.applyWorldMap);
}
export async function readWorldMapTiles(input) {
  const desktop = desktopBridge();
  if (!desktop?.readWorldMapTiles) return null;
  return desktop.readWorldMapTiles(input);
}

/**
 * Векторная карта штата из игры игрока (Т-159): `{ atlas, geometry }` или
 * `null` — без Astral Desktop, без игры или без геометрии радара.
 */
export async function readWorldMapGeometry(input) {
  const desktop = desktopBridge();
  if (!desktop?.readWorldMapGeometry) return null;
  return desktop.readWorldMapGeometry(input);
}
/*
 * Палитра векторных плиток радара: какие цвета игра рисует в углу экрана.
 * Окно красит их тем же конвейером, что и растровую карту, и отдаёт пары
 * обратно — одна палитра на карту паузы и на мини-карту.
 */
export async function readRadarTileColours(input) {
  const desktop = desktopBridge();
  if (!desktop?.readRadarTileColours) return null;
  return desktop.readRadarTileColours(input);
}
/*
 * Остров Кайо-Перико (19.10.2026): его на радаре и на карте паузы рисует
 * отдельный фильм Scaleform. Приложение отдаёт его чистым, как у Rockstar, и
 * палитру заливок; окно красит фильм цветами карты и рисует тем же
 * `@modovik/gfx`, что и игра читает. `null` — без приложения или без игры.
 */
export async function readWorldMapIsland(input) {
  const desktop = desktopBridge();
  if (!desktop?.readWorldMapIsland) return null;
  return desktop.readWorldMapIsland(input);
}
/*
 * Штатная карта Rockstar: что показывает игра и к чему вернётся после
 * снятия карты. Возврат штатной — обычная установка пакета из штатных файлов
 * самого игрока, когда снятием своей карты её не вернуть.
 */
export async function stockWorldMapStatus(input) {
  const desktop = desktopBridge();
  if (!desktop?.worldMapStockStatus)
    throw new Error("Сверка со штатной картой доступна в приложении Astral.");
  return callDesktop(() => desktop.worldMapStockStatus(input));
}
export async function restoreStockWorldMap(input) {
  const desktop = desktopBridge();
  if (!desktop?.restoreStockWorldMap)
    throw new Error("Возврат штатной карты доступен в приложении Astral.");
  return callDesktop(() => desktop.restoreStockWorldMap(input));
}
export async function beginWorldMapExport(input) {
  const desktop = desktopBridge();
  if (!desktop?.beginWorldMapExport)
    throw new Error("Применение карты доступно только в Astral Desktop.");
  return desktop.beginWorldMapExport(input);
}
export async function stageWorldMapTile(input) {
  const desktop = desktopBridge();
  if (!desktop?.stageWorldMapTile)
    throw new Error("Применение карты доступно только в Astral Desktop.");
  return desktop.stageWorldMapTile(input);
}
/*
 * Кусок слоёв большой карты для мини-карты (`radar-overlay.js`, файл ARO1):
 * тот же канал и та же сессия, что у плиток, — главный процесс различает их по
 * полю `overlay`. Байты уходят base64: канал держит строки.
 */
function bytesToBase64(bytes) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
export async function stageWorldMapRadarOverlay({ session, index, bytes }) {
  const desktop = desktopBridge();
  if (!desktop?.stageWorldMapTile)
    throw new Error("Применение карты доступно только в Astral Desktop.");
  return desktop.stageWorldMapTile({ session, index, overlay: bytesToBase64(bytes) });
}
export async function endWorldMapExport(input) {
  const desktop = desktopBridge();
  if (!desktop?.endWorldMapExport) return null;
  return desktop.endWorldMapExport(input);
}
export async function planWorldMapCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planWorldMap)
    throw new Error("Применение карты доступно только в Astral Desktop.");
  return desktop.planWorldMap(input);
}
export async function applyWorldMapCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyWorldMap)
    throw new Error("Применение карты доступно только в Astral Desktop.");
  return desktop.applyWorldMap(input);
}
export async function removeWorldMapCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeWorldMap)
    throw new Error("Снятие карты доступно только в Astral Desktop.");
  return desktop.removeWorldMap(input);
}
export async function applyMinimapCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyMinimap)
    throw new Error("Применение мини-карты доступно только в Astral Desktop.");
  return desktop.applyMinimap(input);
}

/* Фильм мини-карты от прежней опции (`minimap-film-repair.js`). Вне приложения проверять нечего. */
export async function checkMinimapFilm(input) {
  const desktop = desktopBridge();
  return desktop?.checkMinimapFilm ? desktop.checkMinimapFilm(input) : { state: "unknown" };
}
export async function applyMinimapFilmRepair(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyMinimapFilmRepair)
    throw new Error("Починка мини-карты доступна только в Astral Desktop.");
  return desktop.applyMinimapFilmRepair(input);
}
export async function reportMinimapFilm(input) {
  const desktop = desktopBridge();
  return desktop?.reportMinimapFilm ? desktop.reportMinimapFilm(input) : null;
}

export async function getStreetLightCapabilities() {
  const desktop = desktopBridge();
  if (!desktop?.getStreetLightCapabilities)
    throw new Error("Кастомизатор фонарей доступен только в Astral Desktop.");
  return desktop.getStreetLightCapabilities();
}

export async function planStreetLightCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planStreetLights)
    throw new Error("Применение фонарей доступно только в Astral Desktop.");
  return desktop.planStreetLights(input);
}

export async function applyStreetLightCustomization(planId) {
  const desktop = desktopBridge();
  if (!desktop?.applyStreetLights)
    throw new Error("Применение фонарей доступно только в Astral Desktop.");
  return desktop.applyStreetLights({ planId });
}

export async function removeStreetLightCustomization(installId) {
  const desktop = desktopBridge();
  if (!desktop?.removeStreetLights)
    throw new Error("Удаление фонарей доступно только в Astral Desktop.");
  return desktop.removeStreetLights({ installId });
}

export async function disableStreetLightCustomization(installId) {
  const desktop = desktopBridge();
  if (!desktop?.disableStreetLights)
    throw new Error("Отключение фонарей доступно только в Astral Desktop.");
  return desktop.disableStreetLights({ installId });
}
/*
 * Чистая база неба из игры: все файлы погоды, weather.xml и облака разом.
 * Единственный вызов неба, у которого отсутствие рабочего стола не ошибка: в
 * браузере редактор показывает эталон Astral и продолжает работать. Поэтому
 * здесь `null`, а не исключение.
 */
export async function readSkyBases(input) {
  const desktop = desktopBridge();
  if (!desktop?.readSkyBases) return null;
  return desktop.readSkyBases(input);
}
/*
 * Небо, которое уже стоит в игре игрока (NVE, coreFx, сборка сервера): список
 * найденного и небо выбранного проектом редактора. В браузере игры нет —
 * список пуст, а взять нечего.
 */
export async function listSkySources(input) {
  const desktop = desktopBridge();
  if (!desktop?.listSkySources) return [];
  return desktop.listSkySources(input);
}
export async function takeSkySource(input) {
  const desktop = desktopBridge();
  if (!desktop?.takeSkySource) throw new Error("Небо из игры берётся только в Astral Desktop.");
  return desktop.takeSkySource(input);
}
/*
 * Текстуры неба из игры игрока. В браузере игры нет, поэтому `null` — обычный
 * ответ, а не сбой: предпросмотр рисует приближение и говорит об этом прямо.
 */
export async function readSkyTextures(input) {
  const desktop = desktopBridge();
  if (!desktop?.readSkyTextures) return null;
  return desktop.readSkyTextures(input);
}
/*
 * Облачные шапки из игры игрока: опись моделей и листы по имени. Как и у
 * текстур неба, без рабочего стола это `null`: кадр остаётся с облаками
 * купола, а не падает.
 */
export async function readCloudHats(input) {
  const desktop = desktopBridge();
  if (!desktop?.readCloudHats) return null;
  return desktop.readCloudHats(input);
}
export async function readCloudHatTexture(input) {
  const desktop = desktopBridge();
  if (!desktop?.readCloudHatTexture) return null;
  return desktop.readCloudHatTexture(input);
}
/* Радуга — отдельный файл в игре: ставится и снимается по выключателю. */
export async function setSkyRainbow(input) {
  const desktop = desktopBridge();
  if (!desktop?.setSkyRainbow)
    throw new Error("Радуга ставится только в Astral Desktop.");
  return desktop.setSkyRainbow(input);
}
/* Какие радуги стоят в игре и поставлены ли нынешней схемой. `null` —
   главный процесс этого ещё не умеет (обновлён без перезапуска). */
export async function inspectSkyRainbow(input) {
  const desktop = desktopBridge();
  if (!desktop?.inspectSkyRainbow) return null;
  return desktop.inspectSkyRainbow(input);
}
/*
 * Умеет ли главный процесс ставить радугу ступенями и готовые облака (с
 * 27.09.2026). В dev-режиме окно обновляется на лету, а главный процесс —
 * только перезапуском Astral: прежний заказал бы радугу новому хосту старым
 * форматом, а готовые облака не узнал бы вовсе. Признак — его новый канал.
 */
export function skyInstallerCurrent() {
  const desktop = desktopBridge();
  return !desktop || typeof desktop.inspectSkyRainbow === "function";
}
/*
 * Разметка выделения (ТЗ 26.10.2026, раздел D): тело `.selmap` с CDN из кэша на диске. Записи сцены с адресом без хоста (файл едет в
 * поставке) окно читает само — `features/workshop/selection-markup/selection-map-loader.js`. Без Desktop возвращает `null`.
 */
export async function loadSelectionMarkupBody(input) {
  const desktop = desktopBridge();
  if (typeof desktop?.loadSelectionMarkup !== "function") return null;
  return desktop.loadSelectionMarkup(input);
}
/*
 * «Интерьеры проектов» (ТЗ 17.10.2026, вечер, задача 10): источники игрока
 * (папки с интерьерами проекта) и каталог интерьеров. Только Astral Desktop.
 */
function projectInteriorsBridge(name) {
  const desktop = desktopBridge();
  if (typeof desktop?.[name] !== "function") throw new Error("Интерьеры проектов доступны только в Astral Desktop.");
  return desktop;
}
export async function readProjectInteriorsState(input) {
  return projectInteriorsBridge("readProjectInteriorsState").readProjectInteriorsState(input);
}
export async function addProjectInteriorsSource(input) {
  return projectInteriorsBridge("addProjectInteriorsSource").addProjectInteriorsSource(input);
}
export async function removeProjectInteriorsSource(input) {
  return projectInteriorsBridge("removeProjectInteriorsSource").removeProjectInteriorsSource(input);
}
export async function readProjectInteriorsCatalog(input) {
  return projectInteriorsBridge("readProjectInteriorsCatalog").readProjectInteriorsCatalog(input);
}
export async function readProjectInteriorsScene(input) {
  return projectInteriorsBridge("readProjectInteriorsScene").readProjectInteriorsScene(input);
}
export async function readProjectInteriorsSheets(input) {
  return projectInteriorsBridge("readProjectInteriorsSheets").readProjectInteriorsSheets(input);
}
/* Пакеты интерьеров с CDN Astral: что скачано и что идёт, скачать, отменить, убрать. */
export async function readProjectInteriorsCdnState(input) {
  return projectInteriorsBridge("readProjectInteriorsCdnState").readProjectInteriorsCdnState(input);
}
export async function fetchProjectInteriorsPack(input) {
  return projectInteriorsBridge("fetchProjectInteriorsPack").fetchProjectInteriorsPack(input);
}
export async function cancelProjectInteriorsPack(input) {
  return projectInteriorsBridge("cancelProjectInteriorsPack").cancelProjectInteriorsPack(input);
}
export async function removeProjectInteriorsPack(input) {
  return projectInteriorsBridge("removeProjectInteriorsPack").removeProjectInteriorsPack(input);
}
export async function planTimecycleCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planTimecycle)
    throw new Error("Установка неба доступна только в Astral Desktop.");
  return desktop.planTimecycle(input);
}
export async function applyTimecycleCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyTimecycle)
    throw new Error("Установка неба доступна только в Astral Desktop.");
  return desktop.applyTimecycle(input);
}
/*
 * Фонари из игры игрока: опись ламп и правила частиц у ламп. Без рабочего
 * стола — `null`, а не сбой: редактор показывает сцену со штатными числами и
 * говорит, что лампы игры не прочитаны. `null` же — главный процесс, который
 * фонарей ещё не знает (окно обновилось, а приложение не перезапускали).
 */
export async function readLampStudio(input) {
  const desktop = desktopBridge();
  if (!desktop?.readLampStudio) return null;
  return desktop.readLampStudio(input);
}
/** Умеет ли эта сборка ставить фонари в игру. */
export function lampStudioSupported() {
  return typeof desktopBridge()?.applyLampStudio === "function";
}
export async function planLampStudio(input) {
  const desktop = desktopBridge();
  if (!desktop?.planLampStudio)
    throw new Error(
      "Фонари ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planLampStudio(input);
}
export async function applyLampStudio(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyLampStudio)
    throw new Error(
      "Фонари ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyLampStudio(input);
}
/*
 * Прострелы: план собирает набор в главном процессе и запоминает его за
 * собой, установка ставит ровно его. Без рабочего стола — не ошибка: окно
 * просто не показывает «Применить».
 */
export function wallbangSupported() {
  return typeof desktopBridge()?.applyWallbang === "function";
}
export async function planWallbang(input) {
  const desktop = desktopBridge();
  if (!desktop?.planWallbang)
    throw new Error(
      "Прострелы ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planWallbang(input);
}
export async function applyWallbang(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyWallbang)
    throw new Error(
      "Прострелы ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyWallbang(input);
}
/*
 * Животные (05.11.2026): список и тело животного читает поток чтения игры, план собирает пакет облика в том же потоке, установка
 * ставит ровно его. Без рабочего стола — не ошибка: окно показывает постановочный кадр и не показывает «Применить».
 */
export function animalsSupported() {
  return typeof desktopBridge()?.applyAnimals === "function";
}
export async function listAnimals(input) {
  const desktop = desktopBridge();
  if (!desktop?.listAnimals) return null;
  return desktop.listAnimals(input);
}
export async function readAnimal(input) {
  const desktop = desktopBridge();
  if (!desktop?.readAnimal) return null;
  return desktop.readAnimal(input);
}
export async function planAnimals(input) {
  const desktop = desktopBridge();
  if (!desktop?.planAnimals)
    throw new Error("Животные ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.");
  return desktop.planAnimals(input);
}
export async function applyAnimals(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyAnimals)
    throw new Error("Животные ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.");
  return desktop.applyAnimals(input);
}
/*
 * Наборы перекраски (запретные зоны, завод, ангар, маппинг): план один на
 * все, «Применить» — свой канал у набора (`set` во входе выбирает его).
 */
export function recolorSupported() {
  return typeof desktopBridge()?.applyRecolor === "function";
}

export async function planRecolor(input) {
  const desktop = desktopBridge();
  if (!desktop?.planRecolor)
    throw new Error(
      "Наборы мастерской ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planRecolor(input);
}
/* Отмена плана по номеру работы (`operationId`): в окне без моста — ничего не делает. */
export async function cancelRecolorPlan(input) {
  const desktop = desktopBridge();
  if (!desktop?.cancelRecolorPlan) return { cancelled: false };
  return desktop.cancelRecolorPlan(input);
}
/* Ход плана по номеру работы: подписка (отписка — вернётся функция); без моста — пустая. */
export function onPlanProgress(listener) {
  return desktopBridge()?.onPlanProgress?.(listener) || (() => {});
}
export async function applyRecolor(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyRecolor)
    throw new Error(
      "Наборы мастерской ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyRecolor(input);
}
/*
 * Листы для 3D-кадров мастерской — из файлов наборов и из игры игрока.
 * Без Astral Desktop (превью в браузере) — `null`: кадр рисует средним
 * цветом.
 */
export async function readWorkshopTextures(input) {
  const desktop = desktopBridge();
  if (!desktop?.readWorkshopTextures) return null;
  return desktop.readWorkshopTextures(input);
}
/*
 * «Интерьеры» (задача 5 ТЗ 11.10.2026): сцена 3D-кадра помещения, собранная
 * Astral Desktop из игры игрока, — `{ scene: ArrayBuffer | null, reason }`.
 * Без Astral Desktop — `null`.
 */
export async function readShopScene(input) {
  const desktop = desktopBridge();
  if (!desktop?.readShopScene) return null;
  return desktop.readShopScene(input);
}
/*
 * «Зоны»: сцена места мира по координатам (origin [x, y, z], reach, gameRoot — в осях игры); ответ — scene: ArrayBuffer или null, reason, skipped.
 * Без Astral Desktop или в старом лаунчере — null.
 */
export async function readWorldPlaceScene(input) {
  const desktop = desktopBridge();
  if (!desktop?.readWorldPlaceScene) return null;
  return desktop.readWorldPlaceScene(input);
}
/*
 * Исходники предпросмотра «Шрифтов»: какие шаблоны есть в Windows этого
 * компьютера, байты шрифта шаблона и штатная библиотека шрифтов игрока.
 * Без Astral Desktop — `null`: предпросмотр рисует только свой файл.
 */
export async function readFontSources(input) {
  const desktop = desktopBridge();
  if (!desktop?.readFontSources) return null;
  return desktop.readFontSources(input);
}
/*
 * Слои оптимизации мастерской: план собирает слой в главном процессе из
 * файлов игры и описи, «включить» ставит ровно его.
 */
export function optimizationLayersSupported() {
  return typeof desktopBridge()?.applyOptimizationLayer === "function";
}
export async function planOptimizationLayer(input) {
  const desktop = desktopBridge();
  if (!desktop?.planOptimizationLayer)
    throw new Error(
      "Слои оптимизации ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planOptimizationLayer(input);
}
export async function applyOptimizationLayer(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyOptimizationLayer)
    throw new Error(
      "Слои оптимизации ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyOptimizationLayer(input);
}
/** Умеет ли эта сборка ставить воду в игру. Браузер — нет, и это не ошибка. */
export function waterApplySupported() {
  return Boolean(desktopBridge()?.applyWater);
}
export async function planWaterCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planWater)
    throw new Error("Установка воды доступна только в Astral Desktop.");
  return desktop.planWater(input);
}
export async function applyWaterCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyWater)
    throw new Error("Установка воды доступна только в Astral Desktop.");
  return desktop.applyWater(input);
}
/** Умеет ли эта сборка ставить траву в игру. Браузер — нет, и это не ошибка. */
export function vegetationApplySupported() {
  return Boolean(desktopBridge()?.applyVegetation);
}
export async function planVegetationCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planVegetation)
    throw new Error(
      "Установка растительности доступна только в Astral Desktop.",
    );
  return desktop.planVegetation(input);
}
/**
 * Набор инструментов правки: ArchiveFix и ключи. В браузере его нет и быть не
 * может — раздел настроек говорит об этом честной строкой, а не пустым списком.
 */
export function workshopToolsSupported() {
  return Boolean(desktopBridge()?.getWorkshopTools);
}
export async function readWorkshopTools() {
  const desktop = desktopBridge();
  if (!desktop?.getWorkshopTools)
    throw new Error("Набор инструментов доступен только в Astral Desktop.");
  return desktop.getWorkshopTools();
}
export async function provisionWorkshopTools() {
  const desktop = desktopBridge();
  if (!desktop?.provisionWorkshopTools)
    throw new Error("Набор инструментов доступен только в Astral Desktop.");
  return desktop.provisionWorkshopTools();
}
export async function revealWorkshopTools() {
  const desktop = desktopBridge();
  if (!desktop?.revealWorkshopTools)
    throw new Error("Набор инструментов доступен только в Astral Desktop.");
  return desktop.revealWorkshopTools();
}
export async function applyVegetationCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyVegetation)
    throw new Error(
      "Установка растительности доступна только в Astral Desktop.",
    );
  return desktop.applyVegetation(input);
}
/** Умеет ли эта сборка ставить арену в игру. Браузер — нет, и это не ошибка. */
export function arenaInstallSupported() {
  return Boolean(desktopBridge()?.applyArena);
}
/** Умеет ли эта сборка показать настоящий зал арены из файлов игры. */
export function arenaHallSupported() {
  return Boolean(desktopBridge()?.loadArenaHallPiece);
}
export async function loadArenaHallManifest(input) {
  const desktop = desktopBridge();
  if (!desktop?.loadArenaHallManifest)
    return {
      status: "unavailable",
      reason: tr("Зал из игры доступен в Astral Desktop."),
    };
  return desktop.loadArenaHallManifest(input);
}
/**
 * Зал арены мода для редактора (25.10.2026): `{ manifest, baseUrl, server }` из разрешения на скачивание каталога → `{ server, scene,
 * sheets, named }` (сцена ARS1 и листы WebP — `ArrayBuffer`). Вне Astral Desktop зала нет: ответ `null`.
 */
export function arenaModHallSupported() {
  return Boolean(desktopBridge()?.readArenaModHall);
}
export async function readArenaModHall(input) {
  const desktop = desktopBridge();
  if (!desktop?.readArenaModHall) return null;
  return desktop.readArenaModHall(input);
}
export async function loadArenaHallPiece(input) {
  const desktop = desktopBridge();
  if (!desktop?.loadArenaHallPiece)
    return {
      status: "unavailable",
      reason: tr("Зал из игры доступен в Astral Desktop."),
    };
  return desktop.loadArenaHallPiece(input);
}
/**
 * Папка с файлами арены, вынутыми из игры.
 *
 * Отдельно от папки мода: там лежит то, что ставят в игру, здесь — то, из чего
 * зал показывают в редакторе.
 */
export async function chooseArenaHallFolder() {
  const desktop = desktopBridge();
  if (!desktop?.chooseArenaHallFolder)
    throw new Error("Выбор папки арены доступен только в Astral Desktop.");
  return desktop.chooseArenaHallFolder();
}
export async function chooseArenaSource() {
  const desktop = desktopBridge();
  if (!desktop?.chooseArenaSource)
    throw new Error("Выбор папки мода доступен только в Astral Desktop.");
  return desktop.chooseArenaSource();
}
export async function inspectArenaSource(input) {
  const desktop = desktopBridge();
  if (!desktop?.inspectArenaSource)
    throw new Error("Чтение мода арены доступно только в Astral Desktop.");
  return desktop.inspectArenaSource(input);
}
export async function planArenaInstall(input) {
  const desktop = desktopBridge();
  if (!desktop?.planArena)
    throw new Error("Установка арены доступна только в Astral Desktop.");
  return desktop.planArena(input);
}
export async function applyArenaInstall(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyArena)
    throw new Error("Установка арены доступна только в Astral Desktop.");
  return desktop.applyArena(input);
}
export async function removeArenaInstall(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeArena)
    throw new Error("Установка арены доступна только в Astral Desktop.");
  return desktop.removeArena(input);
}
/*
 * Что у игрока стоит на килле сейчас. В браузере игры нет, поэтому `null` —
 * обычный ответ: редактор открывается на шаблонах и говорит об этом прямо.
 */
export async function readKillEffectState(input) {
  const desktop = desktopBridge();
  if (!desktop?.readKillEffectState) return null;
  return desktop.readKillEffectState(input);
}
export async function planKillEffectCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planKillEffect)
    throw new Error("Установка килл-эффекта доступна только в Astral Desktop.");
  return desktop.planKillEffect(input);
}
export async function applyKillEffectCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyKillEffect)
    throw new Error("Установка килл-эффекта доступна только в Astral Desktop.");
  return desktop.applyKillEffect(input);
}
/*
 * Эффекты попадания на экране (задача 3, 05.10.2026): что стоит у игрока —
 * числа следа и капли из его игры. В браузере игры нет, поэтому `null` —
 * обычный ответ: кадр рисует каплю своим очерком и говорит об этом.
 */
export async function readScreenHits(input) {
  const desktop = desktopBridge();
  if (!desktop?.readScreenHits) return null;
  return desktop.readScreenHits(input);
}
/** Умеет ли эта сборка ставить след на экране в игру. */
export function screenHitsSupported() {
  return typeof desktopBridge()?.applyScreenHits === "function";
}
export async function planScreenHits(input) {
  const desktop = desktopBridge();
  if (!desktop?.planScreenHits)
    throw new Error(
      "След на экране ставится только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planScreenHits(input);
}
/*
 * DLSS 5 (задача 4, 05.10.2026; с задачи 15 — без шаблонов ReShade). В
 * браузере пакета и игры нет — `null`: вкладка показывает кадры сравнения и
 * говорит, что ставит только Astral Desktop.
 */
export async function readReshade(input) {
  const desktop = desktopBridge();
  if (!desktop?.readReshade) return null;
  return desktop.readReshade(input);
}
export async function applyReshade(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyReshade)
    throw new Error(
      "DLSS 5 ставится только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyReshade(input);
}
/* «Сбросить GTA до стандартной» (Настройки → Игра): без приложения — `null`, окно говорит, что сброс только в Astral. */
export const stockResetAvailable = () => Boolean(desktopBridge()?.scanStockGame);
export async function scanStockGame(input) {
  return desktopBridge()?.scanStockGame?.(input) ?? null;
}
export async function stockScanProgress(input) {
  return desktopBridge()?.stockScanProgress?.(input) ?? null;
}
export async function applyStockReset(input) {
  return desktopBridge()?.applyStockReset?.(input) ?? null;
}
export async function openStockVerify(input) {
  return desktopBridge()?.openStockVerify?.(input) ?? null;
}
export async function listStockQuarantine(input) {
  return (await desktopBridge()?.listStockQuarantine?.(input)) ?? [];
}
export async function restoreStockQuarantine(input) {
  return desktopBridge()?.restoreStockQuarantine?.(input) ?? null;
}
export async function removeReshade(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeReshade)
    throw new Error("DLSS 5 снимается только в Astral Desktop.");
  return desktop.removeReshade(input);
}
/*
 * Настройки графики (задача 15, 06.10.2026): шаблон — в settings.xml игры.
 * В браузере файла игры нет: чтение отвечает `null`, а запись и возврат
 * говорят, что их делает Astral Desktop.
 */
export function hasGameSettingsBridge() {
  return typeof desktopBridge()?.applyGameSettings === "function";
}
export async function readGameSettings() {
  const desktop = desktopBridge();
  if (!desktop?.readGameSettings) return null;
  return desktop.readGameSettings();
}
/*
 * Железо компьютера для рекомендации пресета: `{ gpus: [{ name }], memoryGb,
 * cpu: { threads }, isLaptop }` или `null`, если его не прочитали — в
 * браузере, не на Windows, при сбое опроса. Ответ `null` — не ошибка:
 * страница просто не показывает рекомендацию.
 */
export async function readHardware() {
  const desktop = desktopBridge();
  if (!desktop?.readHardware) return null;
  return (await desktop.readHardware()) || null;
}
export async function applyGameSettings(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyGameSettings)
    throw new Error("Настройки графики записывает только Astral Desktop.");
  return desktop.applyGameSettings(input);
}
export async function restoreGameSettings() {
  const desktop = desktopBridge();
  if (!desktop?.restoreGameSettings)
    throw new Error("Настройки графики возвращает только Astral Desktop.");
  return desktop.restoreGameSettings();
}
/*
 * Чувствительность мыши (круг 6, 29.10.2026): числа в профиле игры. В браузере
 * профиля нет: чтение отвечает `null`, запись и возврат — Astral Desktop.
 */
export async function readMouseSettings() {
  const desktop = desktopBridge();
  if (!desktop?.readMouseSettings) return null;
  return (await desktop.readMouseSettings()) || null;
}
export async function applyMouseSettings(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyMouseSettings)
    throw new Error("Чувствительность мыши записывает только Astral Desktop.");
  return desktop.applyMouseSettings(input);
}
export async function restoreMouseSettings() {
  const desktop = desktopBridge();
  if (!desktop?.restoreMouseSettings)
    throw new Error("Чувствительность мыши возвращает только Astral Desktop.");
  return desktop.restoreMouseSettings();
}
export async function applyScreenHits(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyScreenHits)
    throw new Error(
      "След на экране ставится только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyScreenHits(input);
}
/*
 * Метки и GPS (задача 9 ТЗ 10.10.2026): цвета метки и маршрутов сервера в
 * hudcolor.dat, значок метки в листе значков и узлы дорог игрока. В браузере
 * игры нет: чтение отвечает `null`, кадр говорит, что рисует без неё.
 */
export async function readGps(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGps) return null;
  return desktop.readGps(input);
}
/** Граф дорог игрока для предпросмотра маршрута — `{ nodes, files, base }` или `null`. */
export async function readGpsGraph(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGpsGraph) return null;
  return desktop.readGpsGraph(input);
}
export function gpsSupported() {
  return typeof desktopBridge()?.applyGps === "function";
}
export async function planGps(input) {
  const desktop = desktopBridge();
  if (!desktop?.planGps)
    throw new Error(
      "Метки и GPS ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planGps(input);
}
export async function applyGps(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyGps)
    throw new Error(
      "Метки и GPS ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyGps(input);
}
/*
 * «Полоска HP» (задача 2 ТЗ 11.10.2026): своя полоска здоровья и брони над
 * игроком в метке игрока игры — `{ gameRoot, project }`, работа из
 * `@modovik/reticle-contract` (`normalizeTargetHpProject`).
 */
export function targetHpSupported() {
  return typeof desktopBridge()?.applyTargetHp === "function";
}
export async function planTargetHp(input) {
  const desktop = desktopBridge();
  if (!desktop?.planTargetHp)
    throw new Error(
      "Полоска HP ставится только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planTargetHp(input);
}
export async function applyTargetHp(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyTargetHp)
    throw new Error(
      "Полоска HP ставится только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyTargetHp(input);
}
/*
 * «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер): листы меток игры в словарях
 * script_txds.rpf — `{ gameRoot, project, pictures, previous }`, работа из
 * `@modovik/minimap-contract/group-markers`; чтение отдаёт листы картинками для карточек.
 */
export async function readGroupMarkers(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGroupMarkers) return null;
  return desktop.readGroupMarkers(input);
}
export function groupMarkersSupported() {
  return typeof desktopBridge()?.applyGroupMarkers === "function";
}
export async function planGroupMarkers(input) {
  const desktop = desktopBridge();
  if (!desktop?.planGroupMarkers)
    throw new Error(
      "Групповые метки ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planGroupMarkers(input);
}
export async function applyGroupMarkers(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyGroupMarkers)
    throw new Error(
      "Групповые метки ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyGroupMarkers(input);
}
/*
 * «Иконки» большой карты (05.11.2026): картинки значков карты игры — клетки листов значков в minimap.ytd:
 * `{ gameRoot, work, previous, pictures }`, работа из `@modovik/vector-map/blip-icons`; чтение отдаёт таблицу значков
 * игрока и атлас штатных клеток одной картинкой. Мини-карта и карта паузы — один фильм: значок меняется на обеих.
 */
export async function readBlipIcons(input) {
  const desktop = desktopBridge();
  if (!desktop?.readBlipIcons) return null;
  return desktop.readBlipIcons(input);
}
export function blipIconsSupported() {
  return typeof desktopBridge()?.applyBlipIcons === "function";
}
export async function planBlipIcons(input) {
  const desktop = desktopBridge();
  if (!desktop?.planBlipIcons)
    throw new Error(
      "Значки карты ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planBlipIcons(input);
}
export async function applyBlipIcons(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyBlipIcons)
    throw new Error(
      "Значки карты ставятся только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyBlipIcons(input);
}
/*
 * «Дым из-под колёс» (задача 1 ТЗ 11.10.2026, вечер): клоны правил дыма игры
 * в ядрах частиц и таблица колёс wheelfx.dat — `{ gameRoot, project }`,
 * работа из `@modovik/ptfx-studio/wheel-smoke.js`.
 *
 * База для кадра — правила-доноры игрока и их листы (`{ model, sheets,
 * table, fingerprint }`, с `known` — `{ unchanged: true }`, если не
 * поменялась). Без рабочего стола — `null`, а не сбой: кадр рисует дым без
 * правил игры и говорит об этом. `null` же — главный процесс, который дыма
 * ещё не знает (окно обновилось, а приложение не перезапускали).
 */
export async function readWheelSmokeBase(input) {
  const desktop = desktopBridge();
  if (!desktop?.readWheelSmoke) return null;
  return desktop.readWheelSmoke(input);
}
/** Дрифт-машина кадра из игры игрока: `{ status, glb, car }` или `null`, если главный процесс её не знает. */
export async function readWheelSmokeCar(input) {
  const desktop = desktopBridge();
  if (!desktop?.readWheelSmokeCar) return null;
  return desktop.readWheelSmokeCar(input);
}
/** Умеет ли эта сборка ставить дым из-под колёс в игру. */
export function wheelSmokeSupported() {
  return typeof desktopBridge()?.applyWheelSmoke === "function";
}
export async function planWheelSmoke(input) {
  const desktop = desktopBridge();
  if (!desktop?.planWheelSmoke)
    throw new Error(
      "Настройка автомобиля ставится только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.planWheelSmoke(input);
}
export async function applyWheelSmoke(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyWheelSmoke)
    throw new Error(
      "Настройка автомобиля ставится только в Astral Desktop — перезапустите приложение, если оно уже открыто.",
    );
  return desktop.applyWheelSmoke(input);
}
/*
 * Оптимизация. План собирается по настоящим файлам игрока, поэтому без
 * рабочего стола его не существует: раздел в браузере показывает описание
 * правил из каталога и говорит об этом прямо, а не притворяется планом.
 */
/*
 * Разбор чужого редукса.
 *
 * Всё четыре операции требуют настольного моста: они читают двухгигабайтные
 * архивы с диска и ключи игры. В браузере их нет и быть не может.
 */
export async function chooseReduxArchive() {
  const desktop = desktopBridge();
  if (!desktop?.chooseReduxArchive)
    throw new Error("Разбор редукса доступен только в Astral Desktop.");
  return desktop.chooseReduxArchive();
}
export async function chooseReduxCleanBase() {
  const desktop = desktopBridge();
  if (!desktop?.chooseReduxCleanBase)
    throw new Error("Разбор редукса доступен только в Astral Desktop.");
  return desktop.chooseReduxCleanBase();
}
export async function inspectReduxArchive(input) {
  const desktop = desktopBridge();
  if (!desktop?.inspectReduxArchive)
    throw new Error("Разбор редукса доступен только в Astral Desktop.");
  return desktop.inspectReduxArchive(input);
}
export async function buildReduxPackages(input) {
  const desktop = desktopBridge();
  if (!desktop?.buildReduxPackages)
    throw new Error("Сборка пакетов доступна только в Astral Desktop.");
  return desktop.buildReduxPackages(input);
}
export async function openReduxBatch(input) {
  const desktop = desktopBridge();
  if (!desktop?.openReduxBatch) return null;
  return desktop.openReduxBatch(input);
}
/*
 * Публикация из архива.
 *
 * Разбор, черновики и входящие — на настольном мосту: они читают архивы с
 * диска. Сама публикация идёт через локальный сервер каталога: он подписывает
 * пакет из папки черновика и кладёт карточку в каталог.
 */
export async function choosePublisherSources() {
  const desktop = desktopBridge();
  if (!desktop?.choosePublisherSources)
    throw new Error("Публикация из архива доступна только в Astral Desktop.");
  return desktop.choosePublisherSources();
}
export async function choosePublisherSourceFolder() {
  const desktop = desktopBridge();
  if (!desktop?.choosePublisherSourceFolder)
    throw new Error("Публикация из архива доступна только в Astral Desktop.");
  return desktop.choosePublisherSourceFolder();
}
export function publisherPathsForFiles(files) {
  const desktop = desktopBridge();
  if (!desktop?.pathsForFiles) return [];
  /* Через мост уходят сами File — их предзагрузчик умеет превращать в пути;
     FileList целиком мост не переносит. */
  return desktop.pathsForFiles(Array.from(files || []));
}
export async function inspectPublisherSources(input) {
  const desktop = desktopBridge();
  if (!desktop?.inspectPublisherSources)
    throw new Error("Публикация из архива доступна только в Astral Desktop.");
  return desktop.inspectPublisherSources(input);
}
export async function preparePublisherDrafts(input) {
  const desktop = desktopBridge();
  if (!desktop?.preparePublisherDrafts)
    throw new Error("Подготовка черновиков доступна только в Astral Desktop.");
  return desktop.preparePublisherDrafts(input);
}
export async function listPublisherInbox() {
  const desktop = desktopBridge();
  if (!desktop?.listPublisherInbox) return [];
  return desktop.listPublisherInbox();
}
/* Картинки партий входящих, которые окно рисует (Т-116b): список приходит
   без них. Старый хост картинки отдаёт в списке и этого вызова не знает. */
export async function publisherInboxThumbnails(input) {
  const desktop = desktopBridge();
  if (!desktop?.publisherInboxThumbnails) return {};
  return desktop.publisherInboxThumbnails(input);
}
export async function markPublisherDraftPublished(input) {
  const desktop = desktopBridge();
  if (!desktop?.markPublisherDraftPublished) return null;
  return desktop.markPublisherDraftPublished(input);
}
export async function discardPublisherDraft(input) {
  const desktop = desktopBridge();
  if (!desktop?.discardPublisherDraft)
    throw new Error("Входящие доступны только в Astral Desktop.");
  return desktop.discardPublisherDraft(input);
}
/**
 * Снимок области окна приложения — кадр из плеера обзора. Есть только в
 * Astral Desktop; в браузере кадр снимается захватом вкладки (null здесь).
 */
export async function capturePublisherRegion(input) {
  const desktop = desktopBridge();
  if (!desktop?.capturePublisherRegion) return null;
  return desktop.capturePublisherRegion(input);
}
/** Кадр в заявку: обложкой или в галерею, с происхождением. */
export async function savePublisherDraftFrame(input) {
  const desktop = desktopBridge();
  if (!desktop?.savePublisherDraftFrame)
    throw new Error("Кадры заявок сохраняются только в Astral Desktop.");
  return desktop.savePublisherDraftFrame(input);
}
/** Порядок галереи, удаление кадра, кадр — в обложку, что ещё в кадре. */
export async function updatePublisherDraftMedia(input) {
  const desktop = desktopBridge();
  if (!desktop?.updatePublisherDraftMedia)
    throw new Error("Кадры заявок сохраняются только в Astral Desktop.");
  return desktop.updatePublisherDraftMedia(input);
}
/** Файлы части заявки — обложка «Мастерская» в «Кадрах из обзора». */
export async function readPublisherDraftPartFiles(input) {
  const desktop = desktopBridge();
  if (!desktop?.readPublisherDraftPartFiles)
    throw new Error("Файлы заявки читает Astral Desktop.");
  return desktop.readPublisherDraftPartFiles(input);
}
/** Обзор и авторы партии — один раз на весь редукс. */
export async function setPublisherBatchSources(input) {
  const desktop = desktopBridge();
  if (!desktop?.setPublisherBatchSources)
    throw new Error("Входящие доступны только в Astral Desktop.");
  return desktop.setPublisherBatchSources(input);
}
/** Работа мастерской — во входящие публикации кодом (только Desktop). */
export async function sendWorkToInbox(input) {
  const desktop = desktopBridge();
  if (!desktop?.sendWorkToInbox)
    throw new Error("Входящие доступны только в Astral Desktop.");
  return desktop.sendWorkToInbox(input);
}
/**
 * Звук заявки из входящих → адрес blob: для проигрывания. Адрес живёт,
 * пока его не отпустят `URL.revokeObjectURL`.
 */
export async function publisherDraftAudioUrl(input) {
  const desktop = desktopBridge();
  if (!desktop?.readPublisherDraftAudio)
    throw new Error("Входящие доступны только в Astral Desktop.");
  const { base64, type } = await desktop.readPublisherDraftAudio(input);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type }));
}
/*
 * Задания на разбор (docs/CATALOG-INTAKE.md): очередь — на сервере
 * каталога, разбор — в главном процессе этой машины.
 */
export async function submitIntakeJob(source) {
  return (
    await api("/admin/intake/jobs", {
      method: "POST",
      body: JSON.stringify({ source }),
    })
  ).job;
}
export async function listIntakeJobs(state = "") {
  const query = state ? `?state=${encodeURIComponent(state)}` : "";
  return (await api(`/admin/intake/jobs${query}`)).jobs || [];
}
export async function claimIntakeJob(id, worker) {
  return (
    await api(`/admin/intake/jobs/${encodeURIComponent(id)}/claim`, {
      method: "POST",
      body: JSON.stringify({ worker }),
    })
  ).job;
}
export async function reportIntakeJob(id, patch) {
  return (
    await api(`/admin/intake/jobs/${encodeURIComponent(id)}/progress`, {
      method: "POST",
      body: JSON.stringify(patch),
    })
  ).job;
}
export async function cancelIntakeJob(id) {
  return (
    await api(`/admin/intake/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    })
  ).job;
}
export async function listIntakeTokens() {
  return (await api("/admin/intake/tokens")).tokens || [];
}
export async function issueIntakeToken(input) {
  return api("/admin/intake/tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export async function revokeIntakeToken(id) {
  return api(`/admin/intake/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
/** Умеет ли эта машина разбирать задания (есть главный процесс Astral). */
export function canRunIntakeHere() {
  return Boolean(desktopBridge()?.runPublisherIntakeJob);
}
/** Разбор задания на этой машине (главный процесс) и его ход. */
export async function runPublisherIntakeJob(job) {
  const desktop = desktopBridge();
  if (!desktop?.runPublisherIntakeJob)
    throw new Error("Разбирать задания умеет только Astral Desktop.");
  return desktop.runPublisherIntakeJob({ job });
}
export function onPublisherIntakeProgress(listener) {
  const desktop = desktopBridge();
  return desktop?.onPublisherIntakeProgress?.(listener) || (() => {});
}
/** Подпись и публикация подготовленного пакета из папки черновика. */
export function publishPreparedMod(input) {
  return api("/admin/mods/from-directory", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
/** Трассер из папки заявки эффектов: DDS и обложка на диске, оружие и шансы — от человека. */
export function publishTracerFromDirectory(input) {
  return api("/admin/tracers/from-directory", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
/** Выпуск ядра эффектов Astral: собрано ли и проверено ли в сюжетном режиме. */
export function getPtfxCoreRelease() {
  return api("/admin/ptfx-core");
}
/** Человек подтверждает: ядро запускалось в игре, эффекты видны, ошибок нет. */
export function attestPtfxCoreRelease(input) {
  return api("/admin/ptfx-core/attest", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* Память чистых баз: что приложение помнит и от чего можно отказаться. */
export async function listReduxBaselines() {
  const desktop = desktopBridge();
  if (!desktop?.listReduxBaselines) return [];
  return desktop.listReduxBaselines();
}
export async function forgetReduxBaseline(input) {
  const desktop = desktopBridge();
  if (!desktop?.forgetReduxBaseline)
    throw new Error("Память баз доступна только в Astral Desktop.");
  return desktop.forgetReduxBaseline(input);
}

export async function planOptimizerProfile(input) {
  const desktop = desktopBridge();
  if (!desktop?.planOptimizer)
    throw new Error("Оптимизация доступна только в Astral Desktop.");
  return desktop.planOptimizer(input);
}
export async function applyOptimizerProfile(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyOptimizer)
    throw new Error("Оптимизация доступна только в Astral Desktop.");
  return desktop.applyOptimizer(input);
}
export async function rollbackOptimizerProfile(input) {
  const desktop = desktopBridge();
  if (!desktop?.rollbackOptimizer)
    throw new Error("Оптимизация доступна только в Astral Desktop.");
  return desktop.rollbackOptimizer(input);
}
/*
 * База эффектов попадания: `bloodfx.dat` и опись правил ядра из игры игрока.
 *
 * Как и у неба, отсутствие рабочего стола здесь не ошибка: мастерская
 * открывается в браузере на эталоне Astral и честно об этом пишет. Ошибкой
 * было бы молча показать эталон и назвать его файлом игрока.
 */
export async function readPtfxBase(input) {
  const desktop = desktopBridge();
  if (!desktop?.readPtfxBase) return null;
  return desktop.readPtfxBase(input);
}

export async function planPtfxCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planPtfx)
    throw new Error("Установка эффектов доступна только в Astral Desktop.");
  return desktop.planPtfx(input);
}
export async function applyPtfxCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyPtfx)
    throw new Error("Установка эффектов доступна только в Astral Desktop.");
  return desktop.applyPtfx(input);
}
/*
 * Ганпаки живут только в рабочем столе: чтобы их разобрать, нужен доступ к
 * архивам игры. В браузере мастерская оружия работает на моделях приложения, и
 * пустой список — это состояние, а не ошибка.
 */
/**
 * Иконки стволов из игры игрока (W3): `{ icons: [{ id, png, width, height }],
 * missing, source, cached }` или `null` — нет Astral Desktop, игры или
 * страницы оружия в ней. `gameRoot` — найденная установка Legacy.
 */
export async function readWeaponIcons(input) {
  const desktop = desktopBridge();
  if (!desktop?.readWeaponIcons) return null;
  return desktop.readWeaponIcons(input);
}

export async function listGunpacks() {
  const desktop = desktopBridge();
  if (!desktop?.listGunpacks) return { packs: [] };
  return desktop.listGunpacks();
}
export async function chooseGunpackFile() {
  const desktop = desktopBridge();
  if (!desktop?.chooseGunpack)
    throw new Error("Подключение ганпака доступно только в Astral Desktop.");
  return desktop.chooseGunpack();
}
export async function importGunpack(input) {
  const desktop = desktopBridge();
  if (!desktop?.importGunpack)
    throw new Error("Подключение ганпака доступно только в Astral Desktop.");
  return desktop.importGunpack(input);
}
export async function readGunpackModel(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGunpackModel)
    throw new Error("Модели ганпака доступны только в Astral Desktop.");
  return desktop.readGunpackModel(input);
}
export async function getMegaMallCapabilities() {
  const desktop = desktopBridge();
  if (!desktop?.getMegaMallCapabilities)
    throw new Error("Редактор Mega Mall доступен только в Astral Desktop.");
  return callDesktop(() => desktop.getMegaMallCapabilities());
}
export async function importMegaMallSource(input) {
  const desktop = desktopBridge();
  if (!desktop?.importMegaMallSource)
    throw new Error("Импорт Mega Mall доступен только в Astral Desktop.");
  return callDesktop(() => desktop.importMegaMallSource(input));
}
export async function listMegaMallSources(input) {
  const desktop = desktopBridge();
  if (!desktop?.listMegaMallSources) return [];
  return callDesktop(() => desktop.listMegaMallSources(input));
}
export async function releaseMegaMallSource(input) {
  const desktop = desktopBridge();
  if (!desktop?.releaseMegaMallSource)
    throw new Error(
      "Удаление изображения Mega Mall доступно только в Astral Desktop.",
    );
  return callDesktop(() => desktop.releaseMegaMallSource(input));
}
export async function exportMegaMallProject(input) {
  const desktop = desktopBridge();
  if (!desktop?.exportMegaMallProject)
    throw new Error("Экспорт Mega Mall доступен только в Astral Desktop.");
  return callDesktop(() => desktop.exportMegaMallProject(input));
}
export async function importMegaMallProject(input) {
  const desktop = desktopBridge();
  if (!desktop?.importMegaMallProject)
    throw new Error("Импорт Mega Mall доступен только в Astral Desktop.");
  return callDesktop(() => desktop.importMegaMallProject(input));
}
export async function renderMegaMallPreview(input) {
  const desktop = desktopBridge();
  if (!desktop?.renderMegaMallPreview)
    throw new Error(
      "Канонический предпросмотр Mega Mall доступен только в Astral Desktop.",
    );
  return callDesktop(() => desktop.renderMegaMallPreview(input));
}
/* Реальная модель здания из установленной игры. В браузере и без GTA просто
   отвечаем «недоступно»: превью обязано открыться и без неё. */
/**
 * Партия моделей одним запросом.
 *
 * Поштучный путь платит распаковкой архива и запуском конвертера за КАЖДУЮ
 * модель; комната интерьера — это восемь моделей с общим словарём текстур.
 * Возвращает карту «идентификатор → ответ» той же формы, что одиночная
 * загрузка, чтобы вызывающий разбирал их одинаково.
 */
export async function loadMegaMallBuildingModels(input) {
  const desktop = desktopBridge();
  /* Мягкий отказ, как у одиночной загрузки: без приложения редактор обязан
     открыться и показать схему, а не упасть. */
  if (!desktop?.loadMegaMallBuildingModels)
    return { status: "unavailable", reason: tr("Только в Astral Desktop.") };
  return callDesktop(() => desktop.loadMegaMallBuildingModels(input));
}
export async function loadMegaMallBuildingModel(input) {
  const desktop = desktopBridge();
  if (!desktop?.loadMegaMallBuildingModel)
    return { status: "unavailable", reason: tr("Только в Astral Desktop.") };
  return callDesktop(() => desktop.loadMegaMallBuildingModel(input));
}
/*
 * Секция карты целиком: манифест расстановки (какие детали где стоят и кто
 * кого подменяет на расстоянии) и бандлы GLB с общими текстурами. Мягкий
 * отказ, как у одиночной модели: без приложения превью показывает схему.
 */
export async function loadMegaMallSection(input) {
  const desktop = desktopBridge();
  if (!desktop?.loadMegaMallSection)
    return { status: "unavailable", reason: tr("Только в Astral Desktop.") };
  return callDesktop(() => desktop.loadMegaMallSection(input));
}
export async function loadMegaMallSectionBundle(input) {
  const desktop = desktopBridge();
  if (!desktop?.loadMegaMallSectionBundle)
    return { status: "unavailable", reason: tr("Только в Astral Desktop.") };
  return callDesktop(() => desktop.loadMegaMallSectionBundle(input));
}
/*
 * Прогрев секции молла в фоне: манифест и бандлы собираются заранее, пока
 * человек ещё в каталоге мастерской, — и к плитке молла кэш уже тёплый.
 * Раз на сеанс приложения; байты в окно не едут; провал молчит — прогрев
 * никому ничего не обещал, а без игры его просто нет.
 */
let megaMallWarmRequested = false;
export function warmMegaMallSection({
  sectionId = "davis-mega-mall",
  bundleIds = ["hd", "lod", "near", "props"],
} = {}) {
  const desktop = desktopBridge();
  if (!desktop?.loadMegaMallSection || megaMallWarmRequested)
    return Promise.resolve(null);
  megaMallWarmRequested = true;
  return callDesktop(() =>
    desktop.loadMegaMallSection({ sectionId, warm: bundleIds }),
  ).catch(() => null);
}
export async function planMegaMallCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planMegaMall)
    throw new Error("Установка Mega Mall доступна только в Astral Desktop.");
  return callDesktop(() => desktop.planMegaMall(input));
}
export async function applyMegaMallCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyMegaMall)
    throw new Error("Установка Mega Mall доступна только в Astral Desktop.");
  return callDesktop(() => desktop.applyMegaMall(input));
}
export async function removeMegaMallCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeMegaMall)
    throw new Error("Удаление Mega Mall доступно только в Astral Desktop.");
  return callDesktop(() => desktop.removeMegaMall(input));
}
export async function getInteriorCapabilities(input) {
  const desktop = desktopBridge();
  if (!desktop?.getInteriorCapabilities)
    throw new Error("Редактор интерьеров доступен только в Astral Desktop.");
  return desktop.getInteriorCapabilities(input);
}
export async function planInteriorCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planInterior)
    throw new Error("Установка интерьеров доступна только в Astral Desktop.");
  return desktop.planInterior(input);
}
export async function applyInteriorCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyInterior)
    throw new Error("Установка интерьеров доступна только в Astral Desktop.");
  return desktop.applyInterior(input);
}
export async function removeInteriorCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeInterior)
    throw new Error("Удаление интерьеров доступно только в Astral Desktop.");
  return desktop.removeInterior(input);
}
export async function chooseSoundPackFolder() {
  const desktop = desktopBridge();
  if (!desktop?.chooseSoundPack)
    throw new Error("Готовые наборы звуков ставит Astral Desktop.");
  return desktop.chooseSoundPack({});
}
export async function listInstalledSoundPacks(input) {
  const desktop = desktopBridge();
  if (!desktop?.listSoundPacks)
    throw new Error("Готовые наборы звуков ставит Astral Desktop.");
  return desktop.listSoundPacks(input);
}
export async function planSoundPack(input) {
  const desktop = desktopBridge();
  if (!desktop?.planSoundPack)
    throw new Error("Готовые наборы звуков ставит Astral Desktop.");
  return desktop.planSoundPack(input);
}
export async function applySoundPack(input) {
  const desktop = desktopBridge();
  if (!desktop?.applySoundPack)
    throw new Error("Готовые наборы звуков ставит Astral Desktop.");
  return desktop.applySoundPack(input);
}
export async function removeSoundPack(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeSoundPack)
    throw new Error("Снятие набора звуков доступно в Astral Desktop.");
  return desktop.removeSoundPack(input);
}
export async function planClimbCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planClimbs)
    throw new Error("Установка залазов доступна только в Astral Desktop.");
  return desktop.planClimbs(input);
}
export async function applyClimbCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyClimbs)
    throw new Error("Установка залазов доступна только в Astral Desktop.");
  return desktop.applyClimbs(input);
}
export async function removeClimbCustomization(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeClimbs)
    throw new Error("Удаление залазов доступно только в Astral Desktop.");
  return desktop.removeClimbs(input);
}
/* Скин оружия из мастерской: запечь покраску в текстуры ствола и
   поставить их в Astral Weapons DLC; снять — откатить этот слой. */
export async function applyWeaponSkin(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyWeaponSkin)
    throw new Error("Скин оружия ставит в игру Astral Desktop.");
  return desktop.applyWeaponSkin(input);
}
export async function removeWeaponSkin(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeWeaponSkin)
    throw new Error("Снятие скина оружия доступно в Astral Desktop.");
  return desktop.removeWeaponSkin(input);
}
/* Покраска вещи одежды из игры: запечь в её текстуру и поставить в
   Astral Clothing DLC; снять — откатить этот слой. */
export async function applyClothingSkin(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyClothingSkin)
    throw new Error("Покраску одежды ставит в игру Astral Desktop.");
  return desktop.applyClothingSkin(input);
}
/* Замененка каталога — на вещь, которую выбрал человек («На что
   поставить»): модель и расцветки ложатся под имена этой вещи. */
export async function applyClothingReplacement(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyClothingReplacement)
    throw new Error("Замененки ставит в игру Astral Desktop.");
  return desktop.applyClothingReplacement(input);
}
export async function removeClothingSkin(input) {
  const desktop = desktopBridge();
  if (!desktop?.removeClothingSkin)
    throw new Error("Снятие покраски одежды доступно в Astral Desktop.");
  return desktop.removeClothingSkin(input);
}
/* Тату сервера (наложение из кэша GTA5RP): лист для студии и «Применить» —
   картинка под своим именем в Astral Clothing DLC. */
export async function readServerTattooModel(input) {
  const desktop = desktopBridge();
  if (!desktop?.readServerTattooModel)
    throw new Error("Тату сервера достаёт Astral Desktop.");
  return desktop.readServerTattooModel(input);
}
export async function applyServerTattoo(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyServerTattoo)
    throw new Error("Тату сервера ставит в игру Astral Desktop.");
  return desktop.applyServerTattoo(input);
}
/*
 * Запущена ли GTA V: пока игра открыта, писать в её архивы нельзя, и
 * очередь «Применить» ждёт закрытия, а не падает. Без Astral Desktop —
 * «нет».
 */
export async function workshopGameRunning() {
  const desktop = desktopBridge();
  if (!desktop?.workshopGameRunning) return false;
  try {
    return Boolean((await desktop.workshopGameRunning())?.running);
  } catch {
    return false;
  }
}
/* Модель ствола из игры игрока — для раздела «Вид» мастерской. */
export function gameWeaponModelsAvailable() {
  return Boolean(desktopBridge()?.readGameWeaponModel);
}
export async function readGameWeaponModel(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGameWeaponModel)
    throw new Error("Модели из игры достаёт Astral Desktop.");
  return desktop.readGameWeaponModel(input);
}
/* «В руках»: ствол игры в руке персонажа из игры игрока (задача 2 ТЗ 06.10). */
export function weaponInHandsAvailable() {
  return Boolean(desktopBridge()?.readWeaponInHands);
}
export async function readWeaponInHands(input) {
  const desktop = desktopBridge();
  if (!desktop?.readWeaponInHands)
    throw new Error("Персонажа из игры достаёт Astral Desktop.");
  return desktop.readWeaponInHands(input);
}
/* Тело в стойке без оружия: жертва в 3D-предпросмотрах эффектов (задача 4А, 18.10). */
export function standingBodyAvailable() {
  return Boolean(desktopBridge()?.readStandingBody);
}
export async function readStandingBody(input) {
  const desktop = desktopBridge();
  if (!desktop?.readStandingBody)
    throw new Error("Персонажа из игры достаёт Astral Desktop.");
  return desktop.readStandingBody(input);
}
/*
 * «Анимации» мастерской (ТЗ 29.10.2026-d): клипы игры и свои файлы — только чтение. Список, скелет персонажа, дорожка клипа
 * (повороты костей по кадрам) и позы плиток читает главный процесс в потоке чтения игры (`animations/animation-reads.js`).
 */
export function animationsAvailable() {
  return Boolean(desktopBridge()?.listAnimations);
}
const animationsCall = (name, message) => async (input) => {
  const desktop = desktopBridge();
  if (!desktop?.[name]) throw new Error(message);
  return desktop[name](input);
};
const ANIMATIONS_ONLY_DESKTOP = "Анимации достаёт Astral Desktop.";
export const listAnimations = animationsCall("listAnimations", ANIMATIONS_ONLY_DESKTOP);
export const readAnimationRig = animationsCall("readAnimationRig", ANIMATIONS_ONLY_DESKTOP);
export const readAnimationTrack = animationsCall("readAnimationTrack", ANIMATIONS_ONLY_DESKTOP);
export const readAnimationPoses = animationsCall("readAnimationPoses", ANIMATIONS_ONLY_DESKTOP);
export const chooseAnimationSource = animationsCall("chooseAnimationSource", ANIMATIONS_ONLY_DESKTOP);
export const addAnimationSource = animationsCall("addAnimationSource", ANIMATIONS_ONLY_DESKTOP);
export const removeAnimationSource = animationsCall("removeAnimationSource", ANIMATIONS_ONLY_DESKTOP);
/* Установка замен в игру (ТЗ 29.10-d): план ничего не пишет, «поставить» и «убрать» пересобирают архив игры с точкой отката. */
export const planAnimationInstall = animationsCall("planAnimationInstall", ANIMATIONS_ONLY_DESKTOP);
export const applyAnimationInstall = animationsCall("applyAnimationInstall", ANIMATIONS_ONLY_DESKTOP);
export const removeAnimationInstall = animationsCall("removeAnimationInstall", ANIMATIONS_ONLY_DESKTOP);
export const listInstalledAnimations = animationsCall("listInstalledAnimations", ANIMATIONS_ONLY_DESKTOP);
/* Раны и кровь из системы повреждений педа игры: декали 3D-предпросмотров боя (ТЗ 18.10, задача 4А). */
export function combatDecalsAvailable() {
  return Boolean(desktopBridge()?.readCombatDecals);
}
export async function readCombatDecals(input) {
  const desktop = desktopBridge();
  if (!desktop?.readCombatDecals) throw new Error("Раны и кровь из игры достаёт Astral Desktop.");
  return desktop.readCombatDecals(input);
}
/* «Дошло ли до игры»: файлы скина ствола в пакете игры против установленных. */
export async function verifyWeaponSkin(input) {
  const desktop = desktopBridge();
  if (!desktop?.verifyWeaponSkin)
    throw new Error("Игру проверяет Astral Desktop.");
  return desktop.verifyWeaponSkin(input);
}
/*
 * Одежда для мастерской: вещи категории из игры игрока и вещь из каталога.
 * Модели собирает Astral Desktop — у окна своих моделей одежды нет.
 */
export function gameClothingModelsAvailable() {
  return Boolean(desktopBridge()?.listGameClothing);
}
export async function listGameClothing(input) {
  const desktop = desktopBridge();
  if (!desktop?.listGameClothing)
    throw new Error("Одежду из игры достаёт Astral Desktop.");
  return desktop.listGameClothing(input);
}
/** Вещи Majestic из их вики (Desktop берёт её в рантайме, с кэшем). */
export async function readMajesticWiki(input) {
  const desktop = desktopBridge();
  if (!desktop?.readMajesticWiki) return { status: "unavailable", items: [] };
  return desktop.readMajesticWiki(input);
}
/**
 * Вещи проекта одного пола и вида — имя, магазин, файл и картинка оригинала
 * (задача 2 ТЗ 06.10.2026). Desktop берёт их с сайтов в рантайме, с кэшем.
 */
export async function readProjectClothing(input) {
  const desktop = desktopBridge();
  if (!desktop?.readProjectClothing)
    return { status: "unavailable", items: [], vanilla: [] };
  return desktop.readProjectClothing(input);
}
/** Картинка вещи проекта → `{ bytes, type }` (окно чужих картинок не грузит). */
export async function readProjectPicture(input) {
  const desktop = desktopBridge();
  if (!desktop?.readProjectPicture)
    throw new Error("Картинки вещей проектов приносит Astral Desktop.");
  return desktop.readProjectPicture(input);
}
/**
 * Женские пары мужских вещей категории из игры игрока (ТЗ 29.10.2026, «скин одежды на женского персонажа», п. 2):
 * `{ slot, status, pairs: { <число мужской вещи>: [{ variant, score, why, confident, shape? }] } }` — женская вещь «Моделей»
 * (число со смещением, `@modovik/clothing/gender`), чем подтверждена пара (`label` ярлык, `name` название, `number` номер, `shape` крой) и
 * уверенная ли она. С `variant` — одна вещь, и там, где ярлыка и названия нет, пара ищется по кроям моделей. Прежний Desktop (без `pairs`)
 * отвечает списком вещей — это «пар нет».
 */
export async function listGameClothingPairs(input) {
  const desktop = desktopBridge();
  if (!desktop?.listGameClothing) return { slot: input?.slot || "", status: "no-bridge", pairs: {} };
  const answer = await desktop.listGameClothing({ ...input, pairs: true });
  return answer?.pairs && typeof answer.pairs === "object" ? answer : { slot: input?.slot || "", status: "old-desktop", pairs: {} };
}
/** Вещи самой игры по дополнениям: имя, номер, расцветки (W5, Т-146). */
export async function listGameClothingItems() {
  const desktop = desktopBridge();
  if (!desktop?.listGameClothingItems) return { rows: [] };
  return desktop.listGameClothingItems();
}
/** Вещи серверов из кэша их клиентов на этом ПК (GTA5RP — RAGE:MP). */
export async function listServerClothing() {
  const desktop = desktopBridge();
  if (!desktop?.listServerClothing) return { servers: [] };
  return desktop.listServerClothing();
}
export async function readGameClothingModel(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGameClothingModel)
    throw new Error("Одежду из игры достаёт Astral Desktop.");
  return desktop.readGameClothingModel(input);
}
/**
 * Настоящие расцветки вещи игры (30.10.2026, «варианты у вещей игры»): `{ slot, variant, textures: [{ index, name }] }` — без шахматок-заглушек. Тем же каналом, что вещь игры, с
 * меткой `textureList`; номер из ответа — `texture` у `readGameClothingModel` и `others` персонажа. Desktop без метки ответит моделью — тогда `textures` нет и вариантов не будет.
 */
export async function readGameTextureList(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGameClothingModel) throw new Error("Одежду из игры достаёт Astral Desktop.");
  const answer = await desktop.readGameClothingModel({ ...input, textureList: true });
  return { slot: answer?.slot, variant: answer?.variant, textures: Array.isArray(answer?.textures) ? answer.textures : [] };
}
/*
 * Карточка категории одежды из игры игрока (14.10.2026) — тем же каналом, что
 * вещь из игры, с меткой `card`: ответ — запрос снимка `{ slot, version,
 * shot }`. Desktop без карточек (старый выпуск) ответит отказом или моделью
 * без `shot` — тогда отказ и здесь, и на полке остаётся значок.
 */
export function clothingCardsAvailable() {
  return Boolean(desktopBridge()?.readGameClothingModel);
}
export async function readClothingCard(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGameClothingModel)
    throw new Error("Одежду из игры достаёт Astral Desktop.");
  const card = await desktop.readGameClothingModel({ ...input, card: true });
  if (!card?.shot) throw new Error("Карточку из игры Astral Desktop не прислал.");
  return card;
}
/**
 * Предпросмотр переноса скина мужской вещи на женскую пару (ТЗ 29.10.2026): `{ percent, ok, width, height, coverage, png }` — мера «перенесено N %» и
 * картинка женской развёртки. Тем же каналом, что вещь из игры, с меткой `transferPreview`; без установки.
 */
export async function previewClothingTransfer(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGameClothingModel) throw new Error("Перенос скина на женскую пару считает Astral Desktop.");
  return desktop.readGameClothingModel({ ...input, transferPreview: true });
}
/**
 * Перенос скина мужского МОДА каталога на женскую пару (ТЗ 29.10.2026, пп. 4–5). Мод со своей мужской моделью на женское тело не встаёт — тело другое, — но его
 * картинку можно перенести на похожую женскую вещь игры. Тем же каналом, что модель вещи каталога (`readCatalogClothingModel`), с метками:
 * `femalePairs` → `{ slot, component, pairs: [{ variant, name?, closeness, fits }] }` (похожие женские вещи игры по крою модели мода);
 * `transferPreview` → `{ percent, ok, width, height, coverage, png }` (мера и картинка женской развёртки, без установки).
 */
export async function suggestCatalogFemalePairs(input) {
  const desktop = desktopBridge();
  if (!desktop?.readCatalogClothingModel) throw new Error("Подбор женской пары считает Astral Desktop.");
  return desktop.readCatalogClothingModel({ ...input, femalePairs: true });
}
export async function previewCatalogTransfer(input) {
  const desktop = desktopBridge();
  if (!desktop?.readCatalogClothingModel) throw new Error("Перенос скина на женскую пару считает Astral Desktop.");
  return desktop.readCatalogClothingModel({ ...input, transferPreview: true });
}
/** Умеет ли окно просить снимки вещей игры (Astral Desktop с игрой): без него плитка остаётся значком. */
export const gameItemShotsAvailable = () => Boolean(desktopBridge()?.readGameClothingModel);
/**
 * Снимок вещи самой игры для плитки «Сделать заменёнку» (27.10.2026) — тем же каналом, что вещь из игры, с меткой `itemShot`: ответ —
 * запрос снимка `{ key, version, shot }`. Desktop без снимков ответит отказом или моделью без `shot` — тогда на плитке остаётся значок.
 */
export async function readGameItemShot(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGameClothingModel)
    throw new Error("Вещь из игры снимает Astral Desktop.");
  const answer = await desktop.readGameClothingModel({ ...input, itemShot: true });
  /* «Такой расцветки у вещи нет» (`none`, 22.11.2026): не отказ чтения, а ответ — плитка этой расцветки убирается (`item-shots.js`). */
  if (answer?.none === true) return answer;
  if (!answer?.shot) throw new Error("Снимок вещи Astral Desktop не прислал.");
  return answer;
}
/** Снимок части тела для плитки блэкворка: `{ shot }` с пустым слоем рисунка. */
export async function readBodyZoneShot(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGameClothingModel) throw new Error("Часть тела снимает Astral Desktop.");
  const answer = await desktop.readGameClothingModel({ ...input, bodyZoneShot: true });
  if (!answer?.shot) throw new Error("Снимок части тела Astral Desktop не прислал.");
  return answer;
}
export async function readCatalogClothingModel(input) {
  const desktop = desktopBridge();
  if (!desktop?.readCatalogClothingModel)
    throw new Error("Вещь из каталога собирает Astral Desktop.");
  return desktop.readCatalogClothingModel(input);
}
/** Тату игры игрока (задача 10): что можно заменить рисунком с тела. */
export async function listGameTattoos(input) {
  const desktop = desktopBridge();
  if (!desktop?.listGameTattoos) return { tattoos: [] };
  return desktop.listGameTattoos(input);
}
/** Картинка тату игры для плитки «Замены» — PNG. */
export async function readGameTattooPicture(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGameTattooPicture)
    throw new Error("Картинку тату достаёт Astral Desktop.");
  return desktop.readGameTattooPicture(input);
}
/** Бороды игры игрока (Ц3в): штатные бороды цирюльника как цели замены. Без Desktop — пусто. */
export async function listGameBeards(input) {
  const desktop = desktopBridge();
  if (!desktop?.listGameBeards) return { beards: [] };
  return desktop.listGameBeards(input);
}
/** Лист штатной бороды для плитки — PNG и цвет по умолчанию. */
export async function readGameBeardPicture(input) {
  const desktop = desktopBridge();
  if (!desktop?.readGameBeardPicture)
    throw new Error("Картинку бороды достаёт Astral Desktop.");
  return desktop.readGameBeardPicture(input);
}
/** Борода-вещь, запечённая в лист выбранной штатной бороды: «Будет» плоским рисунком (`sheet` PNG), `coverage`, `outside`, `warn`. */
export async function bakeGameBeard(input) {
  const desktop = desktopBridge();
  if (!desktop?.bakeGameBeard) throw new Error("Бороду запекает Astral Desktop.");
  return desktop.bakeGameBeard(input);
}
/** Ставит бороду в игру пакетом DLC (`sheet` — PNG листа в base64 из `bakeGameBeard`); ответ — `modId`, по нему «Снять из игры». */
export async function applyGameBeard(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyGameBeard) throw new Error("Бороду в игру ставит Astral Desktop.");
  return desktop.applyGameBeard(input);
}
/** Картинки пака тату каталога — «Взять рисунок» (задача 3 ТЗ 06.10, вечер). */
export async function readCatalogTattooPictures(input) {
  const desktop = desktopBridge();
  if (!desktop?.readCatalogTattooPictures)
    throw new Error("Картинки тату каталога достаёт Astral Desktop.");
  return desktop.readCatalogTattooPictures(input);
}
/**
 * Файлы части редукса каталога (небо, килл-эффект) — «Редактировать» в
 * мастерской (11.10). Пакет качает Desktop доверенным путём установки.
 */
export async function readCatalogPartFiles(input) {
  const desktop = desktopBridge();
  if (!desktop?.readCatalogPartFiles)
    throw new Error("Часть каталога открывает в мастерской Astral Desktop.");
  return desktop.readCatalogPartFiles(input);
}
/**
 * Геометрия большой карты части редукса (APG1 в gzip) — «Карта из мода» в
 * редакторе карты (11.10). Пакет качает и разбирает Desktop.
 */
export async function readCatalogPartGeometry(input) {
  const desktop = desktopBridge();
  if (!desktop?.readCatalogPartGeometry)
    throw new Error("Карту мода открывает в мастерской Astral Desktop.");
  return desktop.readCatalogPartGeometry(input);
}
/** «Применить» тату: рисунок с тела — в картинки выбранных тату игры. */
export async function applyTattooPaint(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyTattooPaint)
    throw new Error("Тату ставит в игру Astral Desktop.");
  return desktop.applyTattooPaint(input);
}
/** Приложение умеет собрать персонажа из игры в вещи (окно «3D» мода одежды, «На модельке» мастерской). */
export const hasClothingCharacter = () => Boolean(desktopBridge()?.readClothingCharacter);
/** Приложение собирает вещь каталога из её пакета (в том числе выбранным цветом) — баннер «Установить» и окно «3D». */
export const hasCatalogClothingModel = () => Boolean(desktopBridge()?.readCatalogClothingModel);
/** Персонаж из игры в этой вещи (GLB) — «На модельке» мастерской одежды и окно «3D» мода. */
export async function readClothingCharacter(input) {
  const desktop = desktopBridge();
  if (!desktop?.readClothingCharacter)
    throw new Error(
      "Персонажа собирает Astral Desktop из вашей игры — в браузере его нет.",
    );
  return desktop.readClothingCharacter(input);
}
/**
 * Поднять потоки чтения одежды у Astral Desktop заранее (1.11.2026): первый запрос персонажа и первый список полки после простоя платят за новый поток и разбор его модулей (≈ 0,27 с на каждый).
 * Звать, пока человек идёт к «Одежде» (наведение на плитку редактора, вход в студию). Потоки живут пять минут простоя, поэтому чаще раза в четыре минуты не просим. Desktop без `warm` ответит ошибкой запроса — тихо.
 */
const WARM_CLOTHING_EVERY_MS = 4 * 60_000;
let clothingWarmedAt = -Infinity;
export function warmClothingReaders(now = Date.now()) {
  const desktop = desktopBridge();
  if (!desktop?.readClothingCharacter || !desktop?.listGameClothing || now - clothingWarmedAt < WARM_CLOTHING_EVERY_MS) return Promise.resolve(false);
  clothingWarmedAt = now;
  return Promise.allSettled([desktop.readClothingCharacter({ warm: true }), desktop.listGameClothing({ warm: true })]).then(() => true);
}
/** Вещь под мышью — скачать и разобрать у Desktop заранее (`warmClothingItem`): щелчку остаётся собрать персонажа. Desktop без `warmItem` ответит ошибкой — тихо. */
export function warmWearItem(input) {
  const desktop = desktopBridge();
  if (!desktop?.readClothingCharacter) return Promise.resolve(false);
  return Promise.resolve(desktop.readClothingCharacter({ ...input, warmItem: true })).catch(() => false);
}
export async function getAuthSession() {
  const desktop = desktopBridge();
  if (!desktop?.getCloudSession)
    throw new Error("Облачная сессия доступна только в Astral Desktop.");
  return desktop.getCloudSession();
}
export async function getCloudCatalog(options = {}) {
  if (options.signal?.aborted) throw options.signal.reason;
  const desktop = desktopBridge();
  if (!desktop?.getCloudCatalog)
    throw new Error("Облачный каталог доступен только в Astral Desktop.");
  /* Паки «Интерьеров проектов» — данные редактора, а не моды: полки их не видят. */
  return takeProjectPacks(await loadCloudCatalog(desktop, options));
}
async function loadCloudCatalog(desktop, options) {
  try {
    return await desktop.getCloudCatalog();
  } catch (cloudError) {
    if (options.signal?.aborted) throw options.signal.reason;
    try {
      return await api(API_ROUTES.catalog, { signal: options.signal });
    } catch {
      throw cloudError;
    }
  }
}
/* «Новости Astral» главной (T-129): публичный список облака. Вне Desktop или
   без сети — ошибка, и главная остаётся с запасными записями. */
export async function getCloudShowcase(place) {
  const desktop = desktopBridge();
  if (!desktop?.getCloudShowcase)
    throw new Error("Витрина облака доступна только в Astral Desktop.");
  return desktop.getCloudShowcase(place);
}
export async function sendCloudShowcaseEvents(events) {
  const desktop = desktopBridge();
  if (!desktop?.sendCloudShowcaseEvents)
    throw new Error("События витрины отправляет только Astral Desktop.");
  return desktop.sendCloudShowcaseEvents(events);
}
export async function getCloudNews() {
  const desktop = desktopBridge();
  if (!desktop?.getCloudNews)
    throw new Error("Новости облака доступны только в Astral Desktop.");
  return desktop.getCloudNews();
}
/** Каталог, который главный процесс присылает сам: первые страницы и
 * свежий после запомненного. Ответ — отписка. */
export function onCloudCatalog(listener) {
  return desktopBridge()?.onCloudCatalog?.((catalog) => listener(takeProjectPacks(catalog))) || (() => {});
}
/* Ссылка на мод облачного каталога для Discord (Т-29): строит её Astral
   Desktop — адрес облака знает он. */
export async function getCloudModLink(modID) {
  const desktop = desktopBridge();
  if (!desktop?.getCloudModLink)
    throw new Error("Ссылку на мод даёт Astral Desktop.");
  return desktop.getCloudModLink(modID);
}
export async function getCloudFavorites() {
  const desktop = desktopBridge();
  if (!desktop?.getCloudFavorites) return [];
  return desktop.getCloudFavorites();
}
export async function setCloudFavorite(modId, favorite) {
  const desktop = desktopBridge();
  if (!desktop?.setCloudFavorite)
    throw new Error("Облачная библиотека доступна только в Astral Desktop.");
  return desktop.setCloudFavorite({ modId, favorite });
}
export async function loginAccount() {
  const desktop = desktopBridge();
  if (desktop?.localFirstRunQaMode) {
    return {
      user: {
        id: "019febfb-0000-7000-8000-000000000001",
        name: "Astral Local Admin",
        displayName: "Astral Local Admin",
        email: "admin@astral.local",
        role: "admin",
      },
    };
  }
  if (!desktop?.loginCloud)
    throw new Error("Безопасный вход доступен только в Astral Desktop.");
  return desktop.loginCloud("login");
}
export async function registerAccount() {
  const desktop = desktopBridge();
  if (desktop?.localFirstRunQaMode) return loginAccount();
  if (!desktop?.loginCloud)
    throw new Error("Безопасная регистрация доступна только в Astral Desktop.");
  return desktop.loginCloud("register");
}
/* Вход ждёт браузер, а человек его не видит или передумал: закрыть ожидание. */
export async function cancelLoginAccount() {
  const desktop = desktopBridge();
  if (!desktop?.cancelLoginCloud) return false;
  return desktop.cancelLoginCloud();
}
/** Ссылка входа, пока вход ждёт браузер (пусто — не ждёт): открыть ещё раз или скопировать. */
export async function loginAccountLink() {
  const desktop = desktopBridge();
  if (!desktop?.getCloudLoginLink) return "";
  return String((await desktop.getCloudLoginLink()) || "");
}
export async function logoutAccount() {
  const desktop = desktopBridge();
  if (!desktop?.logoutCloud)
    throw new Error(
      "Выход из облачной сессии доступен только в Astral Desktop.",
    );
  return desktop.logoutCloud();
}
export async function listCloudBuilds() {
  const desktop = desktopBridge();
  if (!desktop?.getCloudBuilds)
    throw new Error("Облачные сборки доступны только в Astral Desktop.");
  return desktop.getCloudBuilds();
}
export async function createCloudBuild(input) {
  const desktop = desktopBridge();
  if (!desktop?.createCloudBuild)
    throw new Error("Облачные сборки доступны только в Astral Desktop.");
  return desktop.createCloudBuild(input);
}
export async function updateCloudBuild(input) {
  const desktop = desktopBridge();
  if (!desktop?.updateCloudBuild)
    throw new Error("Облачные сборки доступны только в Astral Desktop.");
  return desktop.updateCloudBuild(input);
}
export async function deleteCloudBuild(input) {
  const desktop = desktopBridge();
  if (!desktop?.deleteCloudBuild)
    throw new Error("Облачные сборки доступны только в Astral Desktop.");
  return desktop.deleteCloudBuild(input);
}
/*
 * Короткий код работы или сборки (`work-code-share.js`). Оба вызова отвечают
 * статусом, а не отказом: `ok`, `signin`, `quota`, `missing`, `unavailable`.
 * Без моста (браузер, песочница `?qa=isolated`) сервера нет — так и говорим.
 */
export async function shareWorkCode(code) {
  const desktop = desktopBridge();
  if (!desktop?.shareWorkCode) return { status: "unavailable" };
  return desktop.shareWorkCode({ code });
}
export async function openSharedWorkCode(id) {
  const desktop = desktopBridge();
  if (!desktop?.openSharedWorkCode) return { status: "unavailable" };
  return desktop.openSharedWorkCode({ id });
}
export async function sendCloudEvents(events) {
  const desktop = desktopBridge();
  if (!desktop?.sendCloudEvents) {
    throw new Error("Телеметрия приложения доступна только в Astral Desktop.");
  }
  return desktop.sendCloudEvents({ events });
}

export async function analyzeOptimization(input) {
  const desktop = desktopBridge();
  if (!desktop?.analyzeOptimization) {
    throw new Error("Оптимизация доступна только в Astral Desktop.");
  }
  return callDesktop(() => desktop.analyzeOptimization(input));
}

export async function planOptimization(input) {
  const desktop = desktopBridge();
  if (!desktop?.planOptimization) {
    throw new Error("План оптимизации доступен только в Astral Desktop.");
  }
  return callDesktop(() => desktop.planOptimization(input));
}

export async function applyOptimization(input) {
  const desktop = desktopBridge();
  if (!desktop?.applyOptimization) {
    throw new Error("Оптимизация доступна только в Astral Desktop.");
  }
  return callDesktop(() => desktop.applyOptimization(input));
}

export async function rollbackOptimization(input) {
  const desktop = desktopBridge();
  if (!desktop?.rollbackOptimization) {
    throw new Error("Откат оптимизации доступен только в Astral Desktop.");
  }
  return callDesktop(() => desktop.rollbackOptimization(input));
}

export async function getOptimizationHistory() {
  const desktop = desktopBridge();
  if (!desktop?.getOptimizationHistory) return [];
  return callDesktop(() => desktop.getOptimizationHistory());
}

export function onOptimizationProgress(listener) {
  const desktop = desktopBridge();
  if (!desktop?.onOptimizationProgress) return () => {};
  return desktop.onOptimizationProgress(listener);
}
