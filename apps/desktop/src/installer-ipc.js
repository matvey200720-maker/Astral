import {
  announceLaneLimitChanged,
  downloadSignedPackage,
  inspectProfile,
  installPackage,
  installRemotePackage,
  installRemotePackages,
  planPackage,
  refreshStaleComposites,
  releaseStockHold,
  restoreOriginalTarget,
  returnParkedLoaders,
  stockHoldOf,
  takeHostStandingReport,
} from "@modovik/install-engine";
import fs from "node:fs";
import path from "node:path";
import { clearModsShadow } from "./game-loaders.js";
import { ensureLoaders, ensureLoadersFor, loadersNeededBy, retireLoadersIfUnused } from "./loaders-on-demand.js";
import { returnGameAfterCancel } from "./install-cancel-rollback.js";
import { appReduxInstall } from "./redux-install.js";
import { appCatalogAppend } from "./catalog-append.js";
import { appWeaponUpdateRoute } from "./weapon-update-install.js";
import { appClothingUpdateRoute } from "./clothing-update-install.js";
import { appOverlaysUpdateRoute } from "./overlays-update-install.js";
import { catalogNeedsClothingHost } from "./catalog-clothing-host.js";
import { buildPackExtras, extrasOrigin, normalizeExtrasRequest } from "./gunpack-extras.js";
import { forgetRestorePointsAfterReset, nativeRestorePointsRoot } from "./native-restore-chain.js";
import {
  composeRpfArchive,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
  resolveRpfHelperExecutable,
} from "./rpf-composer.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import {
  assertInstallCapacity,
  combineInstallInputs,
  estimateInstallCapacity,
  assertInstallRuntimeSafe,
  watchInstallRuntime,
} from "./install-safety.js";
/* Снятие мода, арена поверх модов, звук пака и подготовка DLC грузятся там, где вызываются: ядро старта их не держит (`tests/main-startup-imports.test.js`, 30.10.2026). */
import { WORKSHOP_BUSY_MESSAGE } from "./workshop-operations.js";
import { RESTORE_POINTS_MOVING_MESSAGE, restorePointsMoving } from "./restore-points-move.js";
import { layerContainersVerifier } from "./dlc-archive-check.js";
import { journalOperation } from "./install-journal.js";
import { tracedStep } from "@modovik/install-engine/install-trace.js";
import { isRecolorModId } from "@modovik/install-engine/recolor-manifest-trust.js";
import { PLACES_DLC_TARGET } from "@modovik/install-engine/places-dlc.js";
/* Сборщики записей — движку по умолчанию (`entry-materializers.js`): любой
   путь установки или удаления, не передавший свой набор, пересоберёт
   update.rpf и звуковые архивы с полным, а не споткнётся о чужой слой.
   Сами сборщики там — переходники, настоящие модули грузятся на первом вызове. */
import { ENTRY_MATERIALIZERS } from "./entry-materializers.js";
import { createProgressThrottle } from "./progress-throttle.js";
import { serverTattooApplyEnabled } from "./server-tattoo-flag.js";
import { holdHousekeeping } from "./cache-housekeeping.js";
import { logPrepare } from "./prepare-log.js";
import { appLog } from "./app-log.js";
import { cancelActiveOperation } from "./operation-cancel.js";
/* Подмена по умолчанию для установщика («одна запись вместо двух», выключатель `ASTRAL_ENGINE_INSTALL_OPS`). */
import "./ops-install.js";

/*
 * Перенос мест мастерской (`migrateInstalledPlaces`) живёт в
 * recolor-customizer, а тот тянет описи всех наборов перекраски — магазины,
 * билборды, растительность: +25 МБ кучи главного процесса (замер 15.10).
 * Подготовка игры зовёт перенос на каждом запуске, а переносить есть что
 * только тому, у кого стоят места или наборы перекраски: остальным модуль не
 * грузится вовсе. Проверка шире переноса — точную делает он сам.
 */
async function migratePlacesIfAny(input) {
  const target = (await inspectProfile({ stateDir: input.stateDir }))?.targets?.[input.targetId];
  const placed = target?.resources?.[PLACES_DLC_TARGET]?.layers?.length;
  if (!placed && !(target?.installed || []).some((item) => isRecolorModId(item?.modId)))
    return { status: "current", migrated: [], failed: [] };
  const { migrateInstalledPlaces } = await import("./recolor-customizer.js");
  return migrateInstalledPlaces(input);
}

// Optional infrastructure must not take the whole preparation down with it. A
// missing prepared package or an unbuilt helper only removes the slots that
// depend on it, so the remaining adapters stay installable. Runtime safety is
// not optional: InstallBlockedError means the game is running or the target is
// unsafe, and that still aborts preparation.
/*
 * Пак тату из каталога (Т-101, решение тимлида 30.09) — под тем же флагом,
 * что тату сервера из мастерской (Т-65), до отчёта Windows 08: останется
 * ли в игре наш `<txd>.ytd`, а не штатный или серверный, ещё не проверено.
 */
export function assertTattooPackAllowed(
  manifest,
  enabled = serverTattooApplyEnabled,
) {
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : [];
  if (!slots.length || !slots.every((slot) => /^tattoo-/.test(String(slot))))
    return;
  if (enabled()) return;
  throw Object.assign(
    new Error(
      "Паки тату ставятся после проверки на Windows: перебивает ли рисунок мода штатное тату в игре. Мод в каталоге, установка откроется после проверки.",
    ),
    { code: "TATTOO_PACK_PENDING" },
  );
}

async function provisionOptional(run) {
  try {
    return await run();
  } catch (error) {
    if (error?.name === "InstallBlockedError") throw error;
    return {
      status: "unavailable",
      changed: false,
      reason: error?.message || String(error),
    };
  }
}

/*
 * Ускоренная загрузка каталога (ТЗ 10.10, задача 4). Окно включает её кнопкой
 * в «Загрузках» и передаёт свою настройку с каждой установкой. Включено —
 * файлы пакета качаются четырьмя линиями; выключено — по одному. Предел
 * перечитывается перед каждым файлом, поэтому переключение действует на
 * идущую установку и ничего не обрывает.
 */
const ACCELERATED_DOWNLOAD_LANES = 4;
let downloadsAccelerated = false;

/*
 * Загрузка наперёд (бета 15.10, владелец: «накидал модов, нажал ускоренную —
 * ничего»): при «Ускоренной загрузке» окно просит скачать следующий мод
 * очереди, пока текущий ставится в игру. Файлы ложатся туда же, куда их
 * положила бы установка (`<загрузки>/<id>/<версия>`), и она берёт их без сети.
 * Установка того же пакета ждёт его загрузку наперёд, а не качает второй раз.
 */
const prefetches = new Map();
const prefetchKey = (manifest) => `${manifest?.id || ""}@${manifest?.version || ""}`;

/*
 * Ввод установки из окна. Права движка решает главный процесс, а не окно:
 * запись мимо `mods/` — только у пакета, чей подписанный манифест сам
 * говорит `scope: "game-root"`; служебные поля движка (`engineInstall`,
 * `_internalTrust`) окну не принадлежат (разбор безопасности 01.11.2026).
 */
/* Нужна ли перешивка моделей: размер не штатный и пакет — пакет оружия. Лёгкая сверка без загрузки сборщика (`catalog-model-scale.js` грузится по требованию). */
const wantsModelScale = (manifest, scale) =>
  Number.isFinite(scale) && scale !== 1 && Array.isArray(manifest?.capabilities) && manifest.capabilities.includes("direct-weapon-dlc-v1");

export function rendererInstallInput(value) {
  const { engineInstall: _engine, _internalTrust: _trust, preparedPackages: _prepared, ...rest } = value || {};
  return {
    ...rest,
    ...(rest.removeModIds === undefined ? {} : { removeModIds: cleanModIdList(rest.removeModIds) }),
    allowGameRootWrites: rest.manifest?.scope === "game-root",
  };
}

/* Сколько пакетов и снимаемых модов окно вправе назвать в одной установке (самый большой редукс владельца — 16 заявок). Пакетов 64, а не 40 (22.11.2026, ганпак по стволам): каталожный ганпак ставится пачкой — пакет на ствол и «прочее ганпака»;
   самый большой пак в снимке каталога (`qa-catalog-real-gunpack-1611.json`, «Brick») — 41 ствол, то есть 42 пакета; 64 — запас в полтора раза. Движок своего предела не имеет, это только защита от ввода окна. */
export const MAX_INSTALL_PACKAGES = 64;
export const MAX_REMOVED_MODS = 64;
/* Id мода без перекодировки: движок чистит id (`cleanId`), и «похожий» id попал бы на другой мод. */
const MOD_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/i;

/** Список id модов из окна: массив строк-id в точной форме, без повторов; иначе отказ. */
export function cleanModIdList(list, limit = MAX_REMOVED_MODS) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error("Список модов должен быть массивом id.");
  const ids = [];
  for (const id of list) {
    if (typeof id !== "string" || !MOD_ID.test(id)) throw new Error("В списке модов есть некорректный id.");
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > limit) throw new Error(`В списке модов больше ${limit} id.`);
  return ids;
}

/**
 * Ввод пачки из окна: `packages` — `[{ manifest, baseUrl, replaceModIds?, origin? }]`, `removeModIds` — кого снять в той же транзакции.
 * Окно называет только пакеты и id; служебные поля движка у него и у каждого пакета отбрасываются, запись мимо `mods/` разрешена,
 * лишь когда `scope: "game-root"` в манифесте каждого пакета (по одному `allowGameRootWrites` на пачку).
 */
export function rendererInstallPackagesInput(value) {
  const { engineInstall: _engine, _internalTrust: _trust, packages, removeModIds, manifest: _manifest, baseUrl: _baseUrl, replaceModIds: _replace, origin: _origin, preparedPackages: _prepared, extras, ...rest } = value || {};
  if (!Array.isArray(packages) || !packages.length) throw new Error("Нечего ставить: пакетов нет.");
  if (packages.length > MAX_INSTALL_PACKAGES) throw new Error(`В одной установке больше ${MAX_INSTALL_PACKAGES} пакетов.`);
  const items = packages.map((item) => {
    if (!item || typeof item !== "object" || !item.manifest || typeof item.manifest !== "object")
      throw new Error("У пакета нет манифеста.");
    return {
      manifest: item.manifest,
      baseUrl: item.baseUrl,
      replaceModIds: Array.isArray(item.replaceModIds) ? item.replaceModIds.filter((id) => typeof id === "string") : [],
      origin: item.origin ?? null,
    };
  });
  const ids = items.map((item) => String(item.manifest.id || ""));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    throw new Error("Пакеты одной установки должны иметь разные id.");
  return {
    ...rest,
    packages: items,
    /* «Прочее ганпака» (`gunpack-extras.js`): окно называет подписанный пакет пака и файлы, главный процесс собирает из них пакет сам. */
    ...(extras ? { extras: normalizeExtrasRequest(extras) } : {}),
    removeModIds: cleanModIdList(removeModIds),
    allowGameRootWrites: items.every((item) => item.manifest.scope === "game-root"),
  };
}

export function registerInstallerIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  app,
  findGame,
  desktopStorage,
  catalogPublicKey,
  activeOperations,
  downloadHostAllowlist,
  localDevelopmentBuild,
  settingsPlanner,
  settingsInstaller,
  gtaSettingsPath,
  gtaSettingsStateDir,
  workshopBusy = () => false,
  /* Подготовка игры под замком мастерской: её работа ждёт конца подготовки (`workshop-operations.js`). */
  trackPrepare = (task) => task(),
  compileNative = null,
  /* Доставка модов в копию из Rockstar Games Launcher (`rockstar-delivery.js`). */
  rockstarDelivery = null,
  /* Подмена для стенда IPC (`tests/installer-ipc-remote-packages.test.js`): сборщики записей вместо настоящего помощника RPF и
     проверка запуска игры и дозор вместо опроса процессов Windows. В приложении не задаются. */
  engineTools = {},
  /* Подмена подготовки хоста одежды для стенда IPC (`tests/rp-mode-installer-ipc-clothing-host.test.js`): настоящая зовёт помощник RPF и ресурсы приложения. В приложении не задаётся. */
  provisionClothing = null,
  runtimeGuard = {},
}) {
  const assertSafe = runtimeGuard.assertSafe || assertInstallRuntimeSafe;
  const watchRuntime = runtimeGuard.watch || watchInstallRuntime;
  /*
   * Редакторы мастерской и библиотека пишут в тот же update.rpf, но мимо
   * очереди загрузок — нативным хостом и своей перемоткой архива. Пока их
   * операция идёт, очередь не пишет поверх: две записи в один архив разом —
   * это оборванный архив, а не два мода.
   */
  const assertNoWorkshopWrite = () => {
    /* Точки отката переезжают с кэшем (`restore-points-move.js`): запись в игру ждёт конца. */
    if (restorePointsMoving()) throw new Error(RESTORE_POINTS_MOVING_MESSAGE);
    if (workshopBusy()) throw new Error(WORKSHOP_BUSY_MESSAGE);
  };

  /*
   * Подготовка игры. После «Вернуть GTA V без модов» игра остаётся
   * штатной до следующей установки (`stockHold` движка, Т-87): подготовка
   * ничего в неё не пишет — ни метку слоя, ни хосты DLC, ни загрузчики — и
   * отвечает `stockHold`. Снимает его сам игрок: «Установить», загрузчики в
   * настройках, редактор интерьера — `releaseStockHold: true`.
   */
  const prepareGame = async (value) => {
    let targetId = value.targetId;
    let game = await findGame(targetId);
    await assertSafe(game);
    /*
     * Игра из Rockstar Games Launcher (задача 2 ТЗ 07.10.2026): лаунчер
     * Rockstar при каждом запуске возвращает свой update.rpf, и моды в папке
     * игры жили до первого запуска. Моды Astral живут во второй папке: она
     * собирается сама (жёсткие ссылки, место — только под update.rpf),
     * лаунчеры Majestic и RAGE направляются на неё, и готовится уже она.
     * Steam и Epic — без второй папки. Не вышло (другой диск, нет места) —
     * подготовка идёт как раньше, а причина — в ответе.
     *
     * Режим Rockstar включён (14.11.2026): моды идут в саму игру, режим их
     * прячет и возвращает в момент запуска. Вторая папка при этом не собирается
     * и цель на неё не переводится — иначе у человека было бы два пути к модам.
     */
    let rockstarCopy = null;
    if (rockstarDelivery && game.rockstarLauncher && !game.linkedCopy && (await rockstarDelivery.modeOf?.(game.path)) !== "swap") {
      rockstarCopy = await provisionOptional(() => rockstarDelivery.ensureCopyFor({ targetId: game.id }));
      if (rockstarCopy?.copy?.id) {
        targetId = rockstarCopy.copy.id;
        game = await findGame(targetId);
        await assertSafe(game);
      }
    }
    const storageOptions = await desktopStorage().installOptions();
    const holdTarget = { targetId: game.id, stateDir: storageOptions.stateDir };
    // Fetches the pinned ArchiveFix bundle from a third-party origin. Without
    // it only RPF composition is lost, so a network failure must not stop the
    // whole preparation. It lands in Astral's tools, not in the game — the
    // workshop needs it even while the game is held stock.
    const archiveSupport = await provisionOptional(() =>
      provisionArchiveSupport({ stateDir: storageOptions.stateDir }),
    );
    if (value.releaseStockHold) await releaseStockHold(holdTarget);
    const stockHold = await stockHoldOf(holdTarget);
    if (stockHold) return { ...game, stockHold, archiveSupport };
    const assertRuntimeSafety = async () => {
      game = await findGame(targetId);
      await assertSafe(game);
    };
    await clearModsShadow(game.path);
    // Слой Astral идёт первым: резервная копия update.rpf должна лежать
    // на диске раньше любой другой записи в игру, а её отсутствие не
    // зависит от загрузчиков. Ошибка здесь — статус в ответе, а не
    // обрыв всей подготовки: остальные компоненты готовятся дальше.
    const liveArchive = path.join(game.path, "update", "update.rpf");
    const archiveNow = () =>
      fs.promises.stat(liveArchive).then((stat) => ({ size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) }), () => null);
    const archiveBefore = await archiveNow();
    const layerStarted = Date.now();
    const astralLayer = await provisionOptional(async () =>
      (await import("./astral-layer-provisioner.js")).provisionAstralLayer({
        gameRoot: game.path,
        targetId: game.id,
        edition: game.edition,
        stateDir: storageOptions.stateDir,
        assertRuntimeSafety,
      }),
    );
    /* Пересборка архива, подмена снаружи и отказ подготовки слоя — строкой в журнал (`prepare-log.js`). */
    if (astralLayer && (astralLayer.committed || astralLayer.swap || astralLayer.ownEdits || astralLayer.status === "unavailable"))
      logPrepare({
        result: astralLayer,
        before: archiveBefore,
        after: await archiveNow(),
        seconds: (Date.now() - layerStarted) / 1000,
      });
    /* Проверка файлов сняла все моды (задача 2 ТЗ 10.10.2026): игра штатная
       до «Установить снова» или первой установки — дальше подготовка в неё
       не пишет, как после «Вернуть GTA V без модов». */
    if (astralLayer?.status === "stock")
      return { ...game, stockHold: astralLayer.stockHold || { since: new Date().toISOString() }, astralLayer, archiveSupport };
    /*
     * Архивы со звуковыми банками, собранные прежним helper'ом, — заново:
     * он сжимал банк weapons.awc мимо 24-битного поля оглавления, и GTA V
     * падала на загрузке с ERR_GEN_ZLIB_2. Слои модов верны, пересобирается
     * только сам архив — один раз, дальше сборка помнит свою форму.
     */
    const soundArchives = await provisionOptional(async () =>
      (await resolveRpfHelperExecutable().catch(() => null))
        ? refreshStaleComposites({
            targetId: game.id,
            stateDir: storageOptions.stateDir,
            rpfComposer: composeRpfArchive,
            assertRuntimeSafety,
          })
        : { status: "no-helper", refreshed: [], skipped: [] },
    );
    /*
     * Места мастерской, поставленные до 06.10.2026, — в контейнерах
     * update.rpf, и пакеты Rockstar перекрывали их дальние планы (фикс 1):
     * те же файлы работы переезжают в пакет мест Astral, один раз. Окно по
     * ответу переписывает свои записи установок на новые id. Так же
     * переезжают `hei_` файлы растительности и дорог — в архивы сетевой
     * карты своих пакетов (12.10.2026).
     */
    const placesMigration = await provisionOptional(async () =>
      (await resolveRpfHelperExecutable().catch(() => null))
        ? migratePlacesIfAny({
            gameRoot: game.path,
            targetId: game.id,
            stateDir: storageOptions.stateDir,
            tools: { ...(compileNative ? { compile: compileNative } : {}) },
            assertRuntimeSafety,
          })
        : { status: "no-helper", migrated: [], failed: [] },
    );
    /*
     * Загрузчики подготовка больше не ставит (23.11.2026, слово владельца): прямая схема их не требует, а на RP-серверах пара в корне
     * игры — лишний риск. Пара встаёт при установке, которой она нужна (`loaders-on-demand.js`). Миграция: наша пара, поставленная
     * раньше и больше никому не нужная, уходит — тихо, чужое не трогается, занятое откладывается до следующего раза.
     */
    if (value.ensureLoaders === true) {
      /* Кнопка «Установить» в панели «Игра»: строки про загрузчики видны только тому, у кого стоит то, чему пара нужна (`loadersNeededBy`) — она и ставит пару. */
      game = await ensureLoaders({
        game,
        stateDir: storageOptions.stateDir,
        assertRuntimeSafety,
        reread: async () => {
          await assertRuntimeSafety();
          return game;
        },
      });
    } else await retireLoadersIfUnused({ game, stateDir: storageOptions.stateDir, assertRuntimeSafety });
    game = await findGame(game.id).catch(() => game);
    const fastWeaponDlc = await provisionOptional(async () =>
      (await import("./weapon-dlc-provisioner.js")).provisionFastWeaponInfrastructure({
        gameRoot: game.path,
        targetId: game.id,
        edition: game.edition,
        stateDir: storageOptions.stateDir,
        assertRuntimeSafety,
        activate: false,
      }),
    );
    const clothingDlc = await provisionOptional(async () =>
      (await import("./clothing-dlc-provisioner.js")).provisionClothingInfrastructure({
        gameRoot: game.path,
        targetId: game.id,
        edition: game.edition,
        stateDir: storageOptions.stateDir,
        assertRuntimeSafety,
        activate: false,
      }),
    );
    // Ядро эффектов — пакет каталога: без него подготовка не
    // останавливается, но причина не сводится к сырому ENOENT. «Пакета
    // нет в сборке» — ожидаемое состояние со своим кодом; всё остальное
    // (подпись, битый пакет, отказ записи) — сбой, и он пишется в журнал
    // главного процесса. Мастерская эффектов от этого пакета не зависит.
    const ptfxCore = await provisionOptional(async () => {
      try {
        return await (await import("./ptfx-core-provisioner.js")).provisionPtfxCoreInfrastructure({
          gameRoot: game.path,
          targetId: game.id,
          edition: game.edition,
          stateDir: storageOptions.stateDir,
          publicKey: await catalogPublicKey(),
          assertRuntimeSafety,
          packaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
        });
      } catch (error) {
        if (error?.name === "InstallBlockedError") throw error;
        const notBundled = error?.code === "not-bundled";
        if (!notBundled)
          console.warn("Astral PTFX Core provisioning failed:", error);
        return {
          status: notBundled ? "not-bundled" : "unavailable",
          changed: false,
          code: error?.code || "failed",
          reason: error?.message || String(error),
        };
      }
    });
    return {
      ...game,
      /* Окно по этому флагу решает, показывать ли строки про загрузчики (`GamePanel.jsx`). */
      loadersNeeded: await loadersNeededBy({ game, stateDir: storageOptions.stateDir }),
      ...(rockstarCopy ? { rockstarCopy } : {}),
      astralLayer,
      soundArchives,
      placesMigration,
      fastWeaponDlc,
      clothingDlc,
      ptfxCore,
      archiveSupport,
    };
  };

  handleIpc(IPC.PREPARE_GAME, (event, input) =>
    trusted(event, async () => {
      assertNoWorkshopWrite();
      const release = holdHousekeeping();
      try {
        return await trackPrepare(() => prepareGame(safeInput(input)));
      } finally {
        release();
      }
    }),
  );

  handleIpc(IPC.PLAN_PACKAGE, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storageOptions = await desktopStorage().installOptions();
      const plan = await planPackage({
        ...value,
        stateDir: storageOptions.stateDir,
        publicKey: await catalogPublicKey(),
        requireSignature: true,
        rpfProbe: probeRpfArchive,
        settingsPlanner,
      });
      /* Звуковой пак над звуком ствола из мастерской (Т-107b): стволы,
         для которых пак будет молчать, окно называет до установки. */
      const profile = await inspectProfile({
        stateDir: storageOptions.stateDir,
      });
      const { workshopSoundsUnderPack } = await import("./sound-pack-cover.js");
      const soundUnder = workshopSoundsUnderPack(
        value.manifest,
        profile?.targets?.[String(value.targetId || "default")]?.installed,
      );
      return soundUnder.length ? { ...plan, soundUnder } : plan;
    }),
  );

  /*
   * Перенос стоящего в контейнеры RP (20.11.2026, `rp-migrate-offer.js`): по слову человека, не молча. `status` ничего не пишет — считает, что поедет, сколько это стоит и хватит ли места;
   * `run` пересобирает `update.rpf` одной транзакцией (`rp-container-migrate.js`), отменяется до записи тем же `CANCEL_OPERATION`, что установка.
   */
  handleIpc(IPC.RP_MIGRATE_STATUS, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storageOptions = await desktopStorage().installOptions();
      const game = await findGame(value.targetId);
      /* Предложение переноса нужно только по вопросу окна — `import()` (тест `main-startup-imports`, 21.11.2026). */
      const { rpMigrateStatus } = await import("./rp-migrate-offer.js");
      return rpMigrateStatus({ game, stateDir: storageOptions.stateDir });
    }),
  );

  handleIpc(IPC.RP_MIGRATE_RUN, (event, input) =>
    trusted(event, async () => {
      assertNoWorkshopWrite();
      const value = safeInput(input);
      const operationId = typeof value.operationId === "string" ? value.operationId : "";
      if (operationId && activeOperations.has(operationId)) throw new Error("Эта операция уже идёт.");
      const controller = new AbortController();
      if (operationId) activeOperations.set(operationId, controller);
      try {
        const storageOptions = await desktopStorage().installOptions();
        let game = await findGame(value.targetId);
        await assertSafe(game);
        const assertRuntimeSafety = async () => {
          game = await findGame(value.targetId);
          await assertSafe(game);
        };
        const { rpMigrateRun } = await import("./rp-migrate-offer.js");
        return await rpMigrateRun({
          game,
          stateDir: storageOptions.stateDir,
          signal: controller.signal,
          assertRuntimeSafety,
          tools: {
            rpfComposer: composeRpfArchive,
            contentXmlProvider: provideUpdateContentXml,
            dlcListProvider: provideLegacyDlcList,
            tracerMaterializer: ENTRY_MATERIALIZERS.tracerMaterializer,
            ptfxTextureMaterializer: ENTRY_MATERIALIZERS.ptfxTextureMaterializer,
            awcMaterializer: ENTRY_MATERIALIZERS.awcMaterializer,
            bloodRoutingMaterializer: ENTRY_MATERIALIZERS.bloodRoutingMaterializer,
            ...engineTools,
          },
          note: (message) => {
            console.warn(`[astral] ${message}`);
            appLog.record({ level: "warn", source: "install", message });
          },
        });
      } finally {
        if (operationId) activeOperations.delete(operationId);
      }
    }),
  );

  handleIpc(IPC.INSTALL_PACKAGE, (event, input) =>
    trusted(event, async () => {
      assertNoWorkshopWrite();
      const value = rendererInstallInput(safeInput(input));
      const storageOptions = await desktopStorage().installOptions();
      desktopStorage().offerFastInstall?.();
      /* Папка игры — найденная установка, а не путь из окна. */
      let game = await findGame(value.targetId);
      /* Как в пакетной ветке: пара ложится в папку игры, значит игра не должна быть запущена (`assertSafe`). */
      const assertRuntimeSafety = async () => {
        game = await findGame(value.targetId);
        await assertSafe(game);
      };
      /* Пакету из `mods` нужна пара загрузчиков (23.11.2026): встаёт тихо перед установкой; прямым пакетам — не нужна. */
      game = await ensureLoadersFor({
        game,
        manifests: [value.manifest],
        stateDir: storageOptions.stateDir,
        assertRuntimeSafety,
        reread: async () => {
          await assertRuntimeSafety();
          return game;
        },
      });
      /* Оружие через контейнер (`ASTRAL_WEAPONS_VIA_UPDATE=container`): пакет оружия с подписью идёт тем же маршрутом, что установка каталога ниже; без выключателя — `null`, путь прежний. */
      const weaponUpdateRoute = appWeaponUpdateRoute({
        gameRoot: game.path,
        stateDir: storageOptions.stateDir,
        note: (message) => {
          console.warn(`[astral] ${message}`);
          appLog.record({ level: "warn", source: "install", message });
        },
      });
      return installPackage({
        ...value,
        ...(weaponUpdateRoute ? { weaponUpdateRoute } : {}),
        gameRoot: game.path,
        edition: game.edition,
        stateDir: storageOptions.stateDir,
        publicKey: await catalogPublicKey(),
        requireSignature: true,
        rpfComposer: composeRpfArchive,
        rpfProbe: probeRpfArchive,
        dlcListProvider: provideLegacyDlcList,
        contentXmlProvider: provideUpdateContentXml,
        settingsInstaller,
        tracerMaterializer: ENTRY_MATERIALIZERS.tracerMaterializer,
        ptfxTextureMaterializer: ENTRY_MATERIALIZERS.ptfxTextureMaterializer,
        awcMaterializer: ENTRY_MATERIALIZERS.awcMaterializer,
        bloodRoutingMaterializer: ENTRY_MATERIALIZERS.bloodRoutingMaterializer,
        /* Контейнеры слоя Astral (арена автора, залазы, интерьеры) перечитываются до подмены update.rpf (`dlc-archive-check.js`). */
        layerVerifier: layerContainersVerifier(),
      });
    }),
  );

  handleIpc(IPC.PREFETCH_PACKAGE, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const key = prefetchKey(value?.manifest);
      if (!value?.manifest || key === "@") throw new Error("Не указан пакет для загрузки наперёд.");
      if (!prefetches.has(key)) {
        const job = (async () => {
          const storageOptions = await desktopStorage().installOptions();
          /* Наперёд — только если пакет поместится в бюджет и его можно держать до установки. */
          const { packageBytes } = estimateInstallCapacity({ manifest: value.manifest });
          const room = await desktopStorage().makeRoom({ incomingBytes: packageBytes, packageBytes }).catch(() => null);
          if (room && !room.keepDownloads) return { prefetched: false, reason: "budget" };
          await downloadSignedPackage({
            manifest: value.manifest,
            baseUrl: value.baseUrl,
            publicKey: await catalogPublicKey(),
            stateDir: storageOptions.stateDir,
            downloadsDir: storageOptions.downloadsDir,
            allowInsecureLocalhost: !app.isPackaged || localDevelopmentBuild,
            allowedHosts: app.isPackaged && !localDevelopmentBuild ? downloadHostAllowlist : null,
            downloadLanes: () => (downloadsAccelerated ? ACCELERATED_DOWNLOAD_LANES : 1),
          });
          return { prefetched: true };
        })()
          .catch((error) => ({ prefetched: false, reason: String(error?.message || error).slice(0, 300) }))
          .finally(() => prefetches.delete(key));
        prefetches.set(key, job);
      }
      return prefetches.get(key);
    }),
  );

  handleIpc(IPC.SET_DOWNLOADS_ACCELERATED, (event, input) =>
    trusted(event, () => {
      downloadsAccelerated = input?.enabled === true;
      announceLaneLimitChanged();
      return { accelerated: downloadsAccelerated };
    }),
  );

  handleIpc(IPC.INSTALL_REMOTE_PACKAGE, (event, input) =>
    trusted(event, () => runRemoteInstall(event, rendererInstallInput(safeInput(input)), false)),
  );

  /*
   * Несколько пакетов каталога одной транзакцией (Р2, 10.11.2026): компонент из нескольких пакетов, смена варианта сборки
   * («поставить A, снять B»). Ход тот же, что у одного пакета, — `runRemoteInstall` один на оба канала.
   */
  handleIpc(IPC.INSTALL_REMOTE_PACKAGES, (event, input) =>
    trusted(event, () => runRemoteInstall(event, rendererInstallPackagesInput(safeInput(input)), true)),
  );

  /*
   * Установка из каталога: один пакет (`many` ложь) или пачка (`input.packages`). Все шаги — для каждого пакета:
   * проверка игры, тату-паки, подготовка после возврата игры, план; бюджет хранилища и место — по сумме пакетов;
   * сторож запуска игры, отмена и ход — одним `operationId`; пересбор арены поверх модов — после установки.
   * `removeModIds` — моды, которые уходят в той же транзакции без пересечения с пакетами (смена варианта сборки).
   */
  async function runRemoteInstall(event, input, many) {
    const { packages: listed, removeModIds: removing = [], manifest, baseUrl, replaceModIds, origin, extras, ...common } = input;
    const items = many ? listed : [{ manifest, baseUrl, replaceModIds, origin }];
    const label = String(common.name || items[0]?.manifest?.id || "мод").slice(0, 80);
    return journalOperation(`Каталог: ${many && !common.name ? `${items.length} пакетов` : label}`, async () => {
      const operationId = String(common.operationId || "")
        .replace(/[^a-z0-9._-]/gi, "")
        .slice(0, 120);
      if (!operationId) throw new Error("Не указан идентификатор операции.");
      assertNoWorkshopWrite();
      for (const item of items) assertTattooPackAllowed(item.manifest);
      if (activeOperations.has(operationId)) {
        throw new Error("Такая операция уже выполняется.");
      }
      const controller = new AbortController();
      activeOperations.set(operationId, controller);
      /* Плашка первой установки («Быстрая установка»): установку не держит. */
      desktopStorage().offerFastInstall?.();
      delete common.operationId;
      delete common.downloadsDir;
      delete common.retainDownloads;
      /* Окно передаёт свою настройку с каждой установкой — она же начальная. */
      if (typeof common.accelerated === "boolean")
        downloadsAccelerated = common.accelerated;
      delete common.accelerated;
      let stopRuntimeWatch = () => {};
      let result;
      /* Что вернуть, если установку отменят после того, как она сама подготовила игру (`install-cancel-rollback.js`). */
      let preparedHere = null;
      /* Не чаще десяти раз в секунду: движок сообщает на каждый кусок сети,
         и каждое сообщение — перерисовка оболочки (см. progress-throttle.js). */
      const sendProgress = createProgressThrottle((progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.INSTALL_PROGRESS, progress);
        }
      });
      try {
        let game = await findGame(common.targetId);
        const assertRuntimeSafety = async () => {
          game = await findGame(common.targetId);
          await assertSafe(game);
        };
        await tracedStep("проверка игры", () => assertRuntimeSafety());
        /* OpenIV могли поставить, пока Astral открыт: подготовка этого уже не видела. */
        await clearModsShadow(game.path);
        const storage = desktopStorage();
        const storageOptions = await storage.installOptions();
        /* Пакету из `mods` нужна пара загрузчиков (23.11.2026): встаёт тихо, прямо перед установкой; прямым пакетам — не нужна. */
        game = await ensureLoadersFor({
          game,
          manifests: items.map((item) => item.manifest),
          stateDir: storageOptions.stateDir,
          assertRuntimeSafety,
          reread: async () => {
            await assertRuntimeSafety();
            return game;
          },
        });
        /* Снять можно только то, что стоит в этой игре, и только то, что окно могло бы снять обычным снятием (`UNINSTALL_PACKAGE`). */
        if (removing.length) {
          const installedNow = (await inspectProfile({ stateDir: storageOptions.stateDir }))?.targets?.[game.id]?.installed || [];
          const stranger = removing.find((id) => !installedNow.some((record) => record?.modId === id));
          if (stranger) throw new Error(`Мод ${stranger} не установлен в этой игре: снимать нечего.`);
        }
        /* Этот же пакет уже качается наперёд — дождаться, а не качать второй раз. */
        for (const item of items) await prefetches.get(prefetchKey(item.manifest))?.catch(() => null);
        /* Первая установка после «Вернуть GTA V без модов» готовит игру
           сама, если окно этого ещё не сделало. */
        if (
          await stockHoldOf({
            targetId: game.id,
            stateDir: storageOptions.stateDir,
          })
        ) {
          await tracedStep("подготовка игры", () => prepareGame({ targetId: game.id, releaseStockHold: true }));
          /* Подготовка — запись в игру вне транзакции пакета (метка слоя в update.rpf): при отмене её возвращает `returnGameAfterCancel`. */
          preparedHere = { targetId: game.id, gameRoot: game.path, stateDir: storageOptions.stateDir, assertRuntimeSafety };
          /* Отмена, пришедшая за время подготовки, не ждёт ни плана, ни скачивания. */
          controller.signal.throwIfAborted();
        }
        /* Ганпак каталога готовит хост оружия сам, как ганпак мастерской (`gunpack-install.js`): готовый хост отвечает сразу, изменённый
           собирается заново до скачивания. Иначе пакет качался минутами и падал с «Astral Weapons DLC не подготовлен» до перезапуска Astral. */
        /* Оружие через update.rpf (20.11.2026, `weapon-update-install.js`): только при `ASTRAL_WEAPONS_VIA_UPDATE`; пусто — `null`, путь прежний. Хост нужен,
           пока в пакете есть файл, который в update.rpf пока не кладётся (штатный пакет-победитель, маска). */
        const weaponUpdateRoute = appWeaponUpdateRoute({
          gameRoot: game.path,
          stateDir: storageOptions.stateDir,
          note: (message) => {
            console.warn(`[astral] ${message}`);
            appLog.record({ level: "warn", source: "install", message });
          },
        });
        if (
          items.some((item) => item.manifest?.capabilities?.includes("direct-weapon-dlc-v1")) &&
          (!weaponUpdateRoute || (await weaponUpdateRoute.needsHost(items.map((item) => item.manifest))))
        )
          await tracedStep("подготовка оружия", async () =>
            (await import("./weapon-dlc-provisioner.js")).provisionFastWeaponInfrastructure({
              gameRoot: game.path,
              targetId: game.id,
              edition: game.edition,
              stateDir: storageOptions.stateDir,
              assertRuntimeSafety,
              activate: false,
            }),
          );
        /* Пакет каталога с файлами в хосте одежды готовит хост одежды сам, как оружие выше (задача В под 1.0.3): иначе при зарегистрированном хосте и нативной правке мастерской (небо, фонари) установка
           отказывала «Astral Clothing DLC не подготовлен или изменён» до перезапуска Astral. Готовый хост отвечает сразу; пакет, целиком ушедший в контейнер, хост не готовит. */
        if (catalogNeedsClothingHost(items.map((item) => item.manifest), { clothingRoute: appClothingUpdateRoute({}), overlaysRoute: appOverlaysUpdateRoute({}) }))
          await tracedStep("подготовка одежды", async () =>
            (provisionClothing || (await import("./clothing-dlc-provisioner.js")).provisionClothingInfrastructure)({
              gameRoot: game.path,
              targetId: game.id,
              edition: game.edition,
              stateDir: storageOptions.stateDir,
              assertRuntimeSafety,
              activate: false,
            }),
          );
        const publicKey = await catalogPublicKey();
        const tools = {
          rpfComposer: composeRpfArchive,
          rpfProbe: probeRpfArchive,
          dlcListProvider: provideLegacyDlcList,
          contentXmlProvider: provideUpdateContentXml,
          tracerMaterializer: ENTRY_MATERIALIZERS.tracerMaterializer,
          ptfxTextureMaterializer: ENTRY_MATERIALIZERS.ptfxTextureMaterializer,
          awcMaterializer: ENTRY_MATERIALIZERS.awcMaterializer,
          bloodRoutingMaterializer: ENTRY_MATERIALIZERS.bloodRoutingMaterializer,
          /* Контейнеры слоя Astral (арена автора, залазы, интерьеры) перечитываются до подмены update.rpf (`dlc-archive-check.js`). */
          layerVerifier: layerContainersVerifier(),
          ...engineTools,
        };
        const plans = [];
        for (const item of items)
          plans.push(
            await tracedStep("план пакета", () => planPackage({
              ...common,
              ...item,
              gameRoot: game.path,
              edition: game.edition,
              stateDir: storageOptions.stateDir,
              publicKey,
              requireSignature: true,
              rpfProbe: tools.rpfProbe,
              settingsPlanner,
            })),
          );
        /* Бюджет «Хранилища» — до скачивания: вытесняемое уходит, малый бюджет — установка потоком. Пачка считается по сумме пакетов. */
        const sized = many
          ? combineInstallInputs(items.map((item) => item.manifest), plans)
          : { manifest: items[0].manifest, plan: plans[0] };
        const estimate = estimateInstallCapacity(sized);
        const room = await tracedStep("бюджет хранилища", () =>
          storage.makeRoom({ incomingBytes: estimate.packageBytes * 2 + estimate.backupBytes, packageBytes: estimate.packageBytes }),
        ).catch(() => null);
        await tracedStep("проверка места", () => assertInstallCapacity({
          ...sized,
          gameRoot: game.path,
          downloadsDir: storageOptions.downloadsDir,
          stateDir: storageOptions.stateDir,
        }));
        stopRuntimeWatch = watchRuntime({
          game,
          controller,
          check: assertRuntimeSafety,
        });
        const engineOptions = {
          downloadLanes: () =>
            downloadsAccelerated ? ACCELERATED_DOWNLOAD_LANES : 1,
          gameRoot: game.path,
          edition: game.edition,
          ...storageOptions,
          retainDownloads: storageOptions.retainDownloads && room?.keepDownloads !== false,
          allowInsecureLocalhost: !app.isPackaged || localDevelopmentBuild,
          allowedHosts:
            app.isPackaged && !localDevelopmentBuild
              ? downloadHostAllowlist
              : null,
          publicKey,
          requireSignature: true,
          signal: controller.signal,
          assertRuntimeSafety,
          onProgress: (progress) =>
            sendProgress({
              operationId,
              ...progress,
              ...(Number(progress.percent) >= 100
                ? { phase: "finalizing", percent: 99, cancellable: false }
                : {}),
            }),
          settingsInstaller,
          ...(removing.length ? { removeModIds: removing } : {}),
          ...tools,
        };
        /* Редукс в свой dlc (проводка 17.11): только при `ASTRAL_ENGINE_REDUX_DLC` и одним пакетом; выключатель пуст — `null`, и в
           настройки установки не попадает ничего. Слово о паре с модом каталога идёт полем `notice` (фаза не меняется). */
        /* Пачка (волна `speed/redux-usable`): путь берёт её, только если приняты все пакеты и нечего снимать (`plan-install.js`). */
        const reduxInstall = appReduxInstall({
          stateDir: storageOptions.stateDir,
          onProgress: engineOptions.onProgress,
          notify: (notice) => sendProgress({ operationId, notice }),
        });
        if (reduxInstall) engineOptions.reduxInstall = reduxInstall;
        /* Дозапись в update.rpf (19.11.2026, `catalog-append.js`): только при `ASTRAL_ENGINE_CATALOG_APPEND=catalog`; пусто — `null`, прежний путь. */
        const appendInstall = appCatalogAppend({
          stateDir: storageOptions.stateDir,
          note: (message) => {
            console.warn(`[astral] ${message}`);
            appLog.record({ level: "warn", source: "install", message });
          },
        });
        if (appendInstall) engineOptions.appendInstall = appendInstall;
        if (weaponUpdateRoute) engineOptions.weaponUpdateRoute = weaponUpdateRoute;
        /* Одежда freemode через контейнер в update.rpf (20.11.2026, `clothing-update-install.js`): только при `ASTRAL_CLOTHING_VIA_UPDATE`; пусто — `null`, путь прежний. */
        const clothingUpdateRoute = appClothingUpdateRoute({
          note: (message) => {
            console.warn(`[astral] ${message}`);
            appLog.record({ level: "warn", source: "install", message });
          },
        });
        if (clothingUpdateRoute) engineOptions.clothingUpdateRoute = clothingUpdateRoute;
        /* Наложения тела (тату, бороды) через контейнер (`overlays-update-install.js`): только при `ASTRAL_OVERLAYS_VIA_UPDATE`; пусто — `null`, путь прежний. */
        const overlaysUpdateRoute = appOverlaysUpdateRoute({
          note: (message) => {
            console.warn(`[astral] ${message}`);
            appLog.record({ level: "warn", source: "install", message });
          },
        });
        if (overlaysUpdateRoute) engineOptions.overlaysUpdateRoute = overlaysUpdateRoute;
        /* Размер модели в руках (библиотека v2): не штатный размер у пакета оружия — модели перешиваются, пакет ставится локальным пакетом ганпака (`catalog-model-scale.js`); 100 % — как раньше. */
        const modelScale = !many && !removing.length ? Number(common.modelScale) : 1;
        /* Замена вокруг смены размера (`catalog-replacements.js`): своя копия того же мода с другим размером уходит этой же установкой — и в 100 %, и в пачке. */
        {
          const { catalogReplacements } = await import("./catalog-replacements.js");
          const standing = (await inspectProfile({ stateDir: storageOptions.stateDir }).catch(() => null))?.targets?.[game.id]?.installed;
          for (const [index, item] of items.entries()) {
            const replaceModIds = catalogReplacements(item, standing, { installingId: item.manifest?.id });
            if (replaceModIds.length || item.replaceModIds?.length) items[index] = { ...item, replaceModIds };
          }
        }
        result = await tracedStep("установка пакета", async () => {
          /* Размер у этого пакета не поменять — ниже ставится подписанный пакет в 100 %, а окно получает причину (`scaleSkipped`). */
          let scaleSkipped = null;
          if (wantsModelScale(items[0]?.manifest, modelScale)) {
            const { installScaledCatalogWeapon } = await import("./catalog-model-scale.js");
            const scaled = await installScaledCatalogWeapon(
              { manifest: items[0].manifest, baseUrl: items[0].baseUrl, modelScale, gameRoot: game.path, targetId: game.id, origin: items[0].origin, replaceModIds: items[0].replaceModIds },
              storageOptions.stateDir,
              {
                publicKey,
                downloadsDir: storageOptions.downloadsDir,
                allowedHosts: engineOptions.allowedHosts,
                allowInsecureLocalhost: engineOptions.allowInsecureLocalhost,
                onProgress: engineOptions.onProgress,
                signal: controller.signal,
                assertRuntimeSafety,
                archiveTools: { rpfProbe: tools.rpfProbe, rpfComposer: tools.rpfComposer, dlcListProvider: tools.dlcListProvider, contentXmlProvider: tools.contentXmlProvider },
                note: (message) => {
                  console.warn(`[astral] ${message}`);
                  appLog.record({ level: "warn", source: "install", message });
                },
              },
            );
            if (!scaled.plainInstall) return scaled;
            scaleSkipped = scaled.scaleSkipped;
          }
          if (!many) {
            const answer = await installRemotePackage({ ...common, ...items[0], ...engineOptions });
            return scaleSkipped ? { ...answer, scaleSkipped } : answer;
          }
          /* «Прочее ганпака»: собирается из файлов подписанного пака и встаёт той же транзакцией, что стволы (`gunpack-extras.js`). Рабочая папка стирается при любом исходе. */
          const prepared = extras
            ? await buildPackExtras(extras, storageOptions.stateDir, {
                publicKey,
                downloadsDir: storageOptions.downloadsDir,
                allowedHosts: engineOptions.allowedHosts,
                allowInsecureLocalhost: engineOptions.allowInsecureLocalhost,
                /* Полоса хода одна на пачку и считается движком по пакетам: качание «прочего» (мегабайты) её не двигает. */
                onProgress: null,
                signal: controller.signal,
                origin: extrasOrigin(items[0]?.origin, extras.label),
              })
            : null;
          /* Без своего `try/finally`: первый `finally` обработчика — тот, что после отката при отмене (`returnGameAfterCancel`, порядок держит `install-cancel-rollback.test.js`). Сначала `Promise.resolve().then`,
             чтобы синхронный бросок движка тоже шёл через стирание рабочей папки, как раньше. */
          return Promise.resolve()
            .then(() => installRemotePackages({ ...common, packages: items, ...(prepared ? { preparedPackages: [prepared.item] } : {}), ...engineOptions }))
            .finally(() => prepared?.dispose());
        });
        /* Сторож моделей-пустышек (`model-safety-guard.js`): что не положено при этой установке — строка в журнал и число с именами в итог (`modelGuard`) для окна. */
        {
          /* `result.modId` — локальный пакет смены размера: снятые из него пустышки числятся за ним, а не за модом каталога. */
          const guard = (await import("./model-safety-guard.js")).withGuardReport(result, [...items.map((item) => item.manifest?.id), result?.modId]);
          if (guard.line) appLog.record({ level: "warn", source: "install", message: guard.line });
          result = guard.result;
        }
        /* Режим RP, «новое заменяет старое» (`host-standing.js`): движок сам снял работы, целиком перекрытые новой (`engineReplaced` — id, окно называет их теми же словами «Заменено», что названную замену), и отметил
           работы, оставшиеся под новой частично (`hostStanding` — признак для окна; слов для него пока нет). Без правила полей нет, ответ прежний. */
        {
          const reports = takeHostStandingReport(items.map((item) => item.manifest?.id));
          const replaced = [...new Set((reports || []).flatMap((item) => item.replaced))];
          const standing = (reports || []).filter((item) => item.partial.length).map(({ modId, partial }) => ({ modId, by: partial }));
          if (result && typeof result === "object" && (replaced.length || standing.length)) result = { ...result, ...(replaced.length ? { engineReplaced: replaced } : {}), ...(standing.length ? { hostStanding: standing } : {}) };
        }
        /* Поставили мод арены (или сняли тот, на чьих файлах собрана работа арены) — работа арены собирается заново поверх его
           файлов, иначе пакет мест закрыл бы мод (16.10). Отказ установку не отменяет. */
        const profile = await inspectProfile({ stateDir: storageOptions.stateDir }).catch(() => null);
        const installedNow = profile?.targets?.[game.id]?.installed || [];
        const records = items.map((item) => installedNow.find((entry) => entry?.modId === item.manifest?.id)).filter(Boolean);
        if (records.length || removing.length)
          await (await import("./layer-works.js")).rebuildArenaOverMods({
            stateDir: storageOptions.stateDir,
            targetId: game.id,
            gameRoot: game.path,
            added: records,
            removed: removing,
            assertRuntimeSafety,
          }).catch((error) => console.warn(`[astral] Арена не пересобралась поверх мода: ${error?.message || error}`));
        /* Звук стволов звукового пака: поставлен пак — его стволы получают звук из его потоков, снят — переопределения снимаются, как при
           обычном снятии (`catalog-uninstall.js`). Отказ установку не отменяет. */
        try {
          const { applyPackWeaponVoice, packWeaponVoiceEnabled, removePackWeaponVoice } = await import("./pack-weapon-overrides.js");
          const voiceOn = packWeaponVoiceEnabled();
          if ((voiceOn && records.length) || removing.length) {
            const studio = await import("./sound-studio.js");
            if (voiceOn)
              for (const record of records)
                await applyPackWeaponVoice({ record, profile, targetId: game.id, gameRoot: game.path, stateDir: storageOptions.stateDir, studio });
            for (const packId of removing)
              await removePackWeaponVoice({ packId, targetId: game.id, gameRoot: game.path, stateDir: storageOptions.stateDir, installed: installedNow, studio });
          }
        } catch (error) {
          console.warn(`[astral] Звук стволов пака не обновился: ${error?.message || error}`);
        }
      } catch (error) {
        /*
         * Отмена крестиком после того, как установка сама подготовила игру
         * (метка слоя в update.rpf, снятое удержание штатной): игра
         * возвращается к «до Astral» тем же движком, что и «Вернуть GTA V без
         * модов». Подмену самого пакета откатывает транзакция движка. Отказ
         * возврата заменяет отмену своим текстом — иначе окно сказало бы
         * «отменено», а файлы остались изменёнными.
         */
        stopRuntimeWatch();
        stopRuntimeWatch = () => {};
        if (preparedHere)
          await returnGameAfterCancel({
            prepared: true,
            error,
            signal: controller.signal,
            onProgress: (progress) => sendProgress({ operationId, ...progress }),
            restore: ({ onProgress }) =>
              restoreOriginalTarget({
                targetId: preparedHere.targetId,
                stateDir: preparedHere.stateDir,
                assertRuntimeSafety: preparedHere.assertRuntimeSafety,
                onProgress,
                contentXmlProvider: provideUpdateContentXml,
                dlcListProvider: provideLegacyDlcList,
              }).then(async () => {
                await returnParkedLoaders(preparedHere.gameRoot).catch(() => []);
                /* Игра «до Astral»: точки работ мастерской больше ни к чему не ведут (как после кнопки сброса). */
                await forgetRestorePointsAfterReset(nativeRestorePointsRoot(), preparedHere.gameRoot || "").catch(() => []);
              }),
          });
        throw error;
      } finally {
        /* Отложенный шаг после конца операции был бы неправдой. */
        sendProgress.cancel();
        stopRuntimeWatch();
        activeOperations.delete(operationId);
        /* Отчёт о хранилище здесь никому не нужен — без него нет второго обхода десятков тысяч файлов. */
        await desktopStorage()
          .prune({ report: false })
          .catch(() => {});
      }
      sendProgress({
        operationId,
        phase: "complete",
        percent: 100,
        cancellable: false,
      });
      return result;
    });
  }

  /* Единственный путь, которым окно прерывает операцию очереди: запрос оставляет строку в журнале до отмены (17.11.2026, `operation-cancel.js`), чтобы по журналу было видно, откуда пришла отмена. */
  handleIpc(IPC.CANCEL_OPERATION, (event, operationId) =>
    trusted(event, () => cancelActiveOperation({ activeOperations, operationId, record: (entry) => appLog.record(entry) })),
  );

  /* Установленные редуксы на новом пути: список для окна и «Выключить / Включить / Освободить место». Игра не должна идти (как у снятия). */
  handleIpc(IPC.REDUX_LAYER, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const { stateDir } = await desktopStorage().installOptions();
      const redux = await import("./redux-install.js");
      if (value.action === "list" || value.action === undefined) return redux.listReduxLayers(stateDir);
      assertNoWorkshopWrite();
      const game = await findGame(value.targetId);
      await assertSafe(game);
      return redux.applyReduxLayerAction({
        action: String(value.action),
        modId: String(value.modId || ""),
        targetId: game.id,
        stateDir,
        ...redux.appReduxLocator({ stateDir }),
      });
    }),
  );

  handleIpc(IPC.UNINSTALL_PACKAGE, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const operationId = String(value.operationId || "")
        .replace(/[^a-z0-9._-]/gi, "")
        .slice(0, 120);
      delete value.operationId;
      if (operationId && activeOperations.has(operationId)) {
        throw new Error("This operation is already running.");
      }
      assertNoWorkshopWrite();
      const controller = new AbortController();
      if (operationId) activeOperations.set(operationId, controller);
      const sendProgress = (progress) => {
        if (operationId && !event.sender.isDestroyed()) {
          event.sender.send(IPC.INSTALL_PROGRESS, {
            operationId,
            ...progress,
          });
        }
      };
      let game = await findGame(value.targetId);
      const assertRuntimeSafety = async () => {
        game = await findGame(value.targetId);
        await assertSafe(game);
      };
      try {
        sendProgress({ phase: "prepare", percent: 6, cancellable: true });
        await assertRuntimeSafety();
        const storageOptions = await desktopStorage().installOptions();
        const { uninstallCatalogMod } = await import("./catalog-uninstall.js");
        const removed = await uninstallCatalogMod({
          modId: value.modId,
          targetId: value.targetId,
          gameRoot: game.path,
          stateDir: storageOptions.stateDir,
          settingsPath: gtaSettingsPath(),
          settingsStateDir: await gtaSettingsStateDir(),
          signal: controller.signal,
          assertRuntimeSafety,
          onProgress: sendProgress,
        });
        /* Сняли мод арены, поверх которого собрана работа арены, — она
           собирается заново из игры (16.10). Отказ снятие не отменяет. */
        await (await import("./layer-works.js")).rebuildArenaOverMods({
          stateDir: storageOptions.stateDir,
          targetId: game.id,
          gameRoot: game.path,
          removed: [value.modId],
          assertRuntimeSafety,
        }).catch((error) => console.warn(`[astral] Арена не пересобралась после снятия мода: ${error?.message || error}`));
        /* Снята последняя работа, которой нужна пара загрузчиков, — пара уходит (только наша; 23.11.2026). */
        await retireLoadersIfUnused({ game, stateDir: storageOptions.stateDir, assertRuntimeSafety });
        return removed;
      } finally {
        if (operationId) activeOperations.delete(operationId);
      }
    }),
  );
}
