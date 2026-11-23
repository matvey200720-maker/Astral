import {
  inspectProfile,
  readPendingForeignConflicts,
  recoverInterruptedTransactions,
  restoreOriginalTarget,
  returnParkedLoaders,
  setForeignChoices,
} from "@modovik/install-engine";
import {
  consolidateWindowProfile,
  windowInstallRecord,
} from "./install-profile-shape.js";
import { createInstallProfileReader } from "./install-profile-reader.js";
import { assertInstallRuntimeSafe } from "./install-safety.js";
import {
  configureCacheHousekeeping,
  housekeepingHeld,
  recordHousekeeping,
  tidyAstralCache,
} from "./cache-housekeeping.js";
import path from "node:path";
import { openFingerprintStore } from "@modovik/install-engine/file-fingerprint.js";
import { runningProcessNames } from "./game-processes.js";
import { createHousekeepingGate, freeSpaceOf } from "./housekeeping-gate.js";
import { chainIndexEnabled, createChainIndexJob } from "./restore-chain-index-job.js";
import { libraryInstallStatus } from "./library-status.js";
import {
  forgetRestorePointsAfterReset,
  nativeRestorePointsRoot,
} from "./native-restore-chain.js";
import {
  recoverLibraryRemovalOnStartup,
  registerLibraryRemovalIpc,
} from "./library-removal-ipc.js";
import { registerInstalledIpc } from "./installed-ipc.js";
import { recoverArchiveSwaps } from "./archive-swap-recovery.js";
import { guardCarriersOnStartup } from "./carriers-start-guard.js";
import { rpModeSettled } from "./rp-mode-channel.js";
import { discoverGames } from "@modovik/game-discovery";
import { WORKSHOP_BUSY_MESSAGE } from "./workshop-operations.js";
import { provideLegacyDlcList, provideUpdateContentXml } from "./rpf-composer.js";
import {
  getSettingsInstallProfile,
  resetSettingsTarget,
} from "./settings-package.js";
import { appLog } from "./app-log.js";
import { restorePointsMoving } from "./restore-points-move.js";
import { handlerLaps, resetTimingLine } from "./reset-timing.js";
import { forgetAllLayerWorks } from "./layer-works.js";
import { EXPRESS_DLC_ENV } from "@modovik/install-engine/express-dlc.js";
import { REDUX_DLC_ENV } from "@modovik/install-engine/redux-dlc.js";
import { settleEngineJournals } from "./engine-journals.js";
import { registerCatalogAppendRecovery } from "./catalog-append.js";
import { archiveKeysDirectory } from "./loader-provisioner.js";
import { engineLocationDefaults, nativeContextDefaultsOf } from "./native-engine.js";
import { resolveRustExecutable } from "./native-engine-rust.js";

/* Папки игр, в которые Astral мог писать: цели движка и найденные копии. */
async function writableGameRoots({ withInstallState, discover = discoverGames }) {
  const { stateDir } = await withInstallState();
  const profile = await inspectProfile({ stateDir }).catch(() => null);
  const roots = Object.values(profile?.targets || {}).map((target) => target?.gameRoot);
  for (const game of await discover().catch(() => [])) roots.push(game?.path);
  return roots.filter(Boolean);
}

/*
 * Оборванные записи движка в архивах игры (экспресс-установка своего dlc правит `update.rpf` на месте, по журналу):
 * `engine-journals.js`. Движок зовётся только там, где он уже писал (след возле `update.rpf`) или где включён
 * экспресс-путь; у всех остальных запуск не платит ничего, кроме одного чтения папки `update`.
 */
export async function settleJournalsOnStartup({ withInstallState, roots, env = process.env, settle = settleEngineJournals, log = appLog }) {
  const { stateDir } = await withInstallState();
  return settle({
    gameRoots: await roots(),
    executable: () => resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaultsOf() || {}) }),
    keysDirectory: () => archiveKeysDirectory({ stateDir }),
    pointsRoot: nativeRestorePointsRoot(),
    force: String(env[EXPRESS_DLC_ENV] || "").trim() !== "" || String(env[REDUX_DLC_ENV] || "").trim() !== "",
    log: (message) => {
      console.warn(`[astral] ${message}`);
      log.record({ level: "warn", source: "install", message });
    },
  });
}

/*
 * Перед запуском игры из Astral (`LAUNCH_GAME` и сеанс Vanilla Guard, `vanilla-guard-ipc.js`): оборванная запись движка в
 * `update.rpf` этой игры (редукс, экспресс) доводится до старта — иначе игра откроет архив с недописанным журналом. Только папка
 * запускаемой игры; сбой доводки запуск не останавливает (он записан в журнал). Игру из Steam и клиентов серверов человек запускает
 * сам, их доводит запуск Astral (`settleJournalsOnStartup`) и первая же установка.
 */
export async function settleBeforeLaunch({ game, withInstallState, env = process.env, settle = settleEngineJournals, log = appLog }) {
  if (!game?.path) return null;
  try {
    const { stateDir } = await withInstallState();
    return await settle({
      gameRoots: [game.path],
      executable: () => resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaultsOf() || {}) }),
      keysDirectory: () => archiveKeysDirectory({ stateDir }),
      pointsRoot: nativeRestorePointsRoot(),
      force: String(env[EXPRESS_DLC_ENV] || "").trim() !== "" || String(env[REDUX_DLC_ENV] || "").trim() !== "",
      log: (message) => {
        console.warn(`[astral] ${message}`);
        log.record({ level: "warn", source: "install", message });
      },
    });
  } catch (error) {
    const message = `Доводка журналов перед запуском игры не вышла: ${error?.message || error}`;
    console.warn(`[astral] ${message}`);
    log.record({ level: "warn", source: "install", message });
    return null;
  }
}

async function recoverInterruptedSwaps({ withInstallState, roots = () => writableGameRoots({ withInstallState }) }) {
  const report = await recoverArchiveSwaps(await roots(), {
    log: (message) => console.warn(`[astral] ${message}`),
  });
  if (report.restored.length || report.removed.length)
    console.warn(`[astral] Подмена архивов после сбоя: возвращено ${report.restored.length}, убрано ${report.removed.length}.`);
  return report;
}

function progressSender(event, IPC, operationId) {
  return (progress) => {
    if (operationId && !event.sender.isDestroyed()) {
      event.sender.send(IPC.INSTALL_PROGRESS, { operationId, ...progress });
    }
  };
}

/* Запись установки для окна — без описей файлов и архивов
   (`install-profile-shape.js`). */
export { windowInstallRecord };

/*
 * Сторож носителя (`carriers-start-guard.js`) зовётся из трёх мест: старт Astral (цепочка восстановления ниже), запуск игры из Astral (`vanilla-guard-ipc.js`) и возврат окна в фокус (`main.js`).
 * Живые зависимости (состояние, поиск игры) знает регистрация каналов; она кладёт сюда запуск сторожа, остальные его зовут. Не зарегистрирована (тесты) — ничего не делается.
 */
let carrierGuardRun = null;
export const guardCarriersAllGames = async () => (carrierGuardRun ? carrierGuardRun(null) : []);
/** Перед запуском игры из Astral: сторож только для этой игры; сбой не останавливает запуск. */
export const guardCarriersBeforeLaunch = async (game) => (carrierGuardRun ? carrierGuardRun(game).catch(() => []) : []);

/*
 * Профиль для окна (06.10.2026; вечером — без остановки главного потока).
 * Файл состояния движка читается и разбирается в потоке-работнике и
 * помнится по отпечатку (`install-profile-reader.js`); восстановление
 * транзакций окно больше не запускает — это делают мутации движка в своей
 * очереди и запуск приложения.
 */
const sharedProfileReader = createInstallProfileReader();

export async function consolidatedProfile({
  withInstallState,
  gtaSettingsStateDir,
  readProfile = sharedProfileReader,
}) {
  const { stateDir } = await withInstallState();
  const [profile, settingsInstalled] = await Promise.all([
    readProfile(stateDir),
    getSettingsInstallProfile({ stateDir: await gtaSettingsStateDir() }),
  ]);
  return consolidateWindowProfile(profile, settingsInstalled);
}

export function registerInstallStateIpc({
  IPC,
  handleIpc,
  /* Каналы, пишущие в игру мимо очереди, идут через замок мастерской. */
  handleGameWrite = handleIpc,
  trusted,
  safeInput,
  withInstallState,
  installOptions,
  nativeContext,
  gtaSettingsPath,
  gtaSettingsStateDir,
  activeOperations,
  operations = null,
  findGame,
  /* Моды в копию из Rockstar Games Launcher (задача 7): где архив с модами. */
  rockstarDelivery = null,
  /*
   * Чем уборка кэша узнаёт, что человек работает за компьютером (`housekeeping-gate.js`):
   * `systemIdleMs()` — сколько он не трогал клавиатуру и мышь, `attention()` — снимок внимания
   * (экран заблокирован, сон, батарея), `updatesBusy()` — идёт ли скачивание или применение обновления.
   * Нет сигналов (тесты) — ворота пропускают, как прежде.
   */
  quiet = null,
}) {
  carrierGuardRun = (only) =>
    guardCarriersOnStartup({
      discover: only ? async () => [only] : discoverGames,
      stateDirOf: async () => (await withInstallState()).stateDir,
      provision: async (input) =>
        (await import("./astral-layer-provisioner.js")).provisionAstralLayer({
          ...input,
          assertRuntimeSafety: async () => assertInstallRuntimeSafe(await findGame(input.targetId)),
        }),
      log: (entry) => appLog.record(entry),
    });
  /* Переезд точек отката (`restore-points-move.js`) для уборки — та же запись. */
  const workshopBusy = () => Boolean(operations?.isBusy()) || restorePointsMoving();
  /*
   * Уборка кэша (`cache-housekeeping.js`): копии update.rpf, которые больше
   * ни к чему не нужны, уходят после каждой записи в игру и при запуске.
   * Идёт в фоне и уступает любой записи — из мастерской и из очереди.
   */
  const gameWriteBusy = () => workshopBusy() || activeOperations.size > 0;
  /*
   * Отпечатки больших архивов помнятся между запусками (задача 6 ТЗ
   * 10.10.2026): без этого каждый запуск читал update.rpf целиком — 2 ГБ —
   * ради уборки и значков библиотеки. Хранилище лежит в памяти движка и
   * переезжает вместе с ней.
   */
  /* Пока GTA V запущена (или стартует через стартёр Rockstar), уборка не читает копии точек: игре нужен диск. */
  const gameRunning = async () =>
    (await runningProcessNames(["GTA5.exe", "GTA5_Enhanced.exe", "PlayGTAV.exe"]).catch(() => [])).length > 0;
  const fingerprintsIn = (stateDir) => openFingerprintStore(path.join(stateDir, "fingerprints.json"));
  void withInstallState()
    .then(({ stateDir }) => fingerprintsIn(stateDir))
    .catch(() => {});
  /*
   * Ворота диска: уборка читает копии update.rpf по 2–3 ГБ и раньше стартовала через 20 секунд
   * после запуска и после каждой записи, не глядя на человека (тестеры: «просто сидели в приложении
   * — диск 100 %, Discord умирает»). Теперь — не раньше нескольких минут после запуска, не при записи,
   * скачивании и обновлении, не при запущенной GTA V, только когда человек не трогает компьютер;
   * читает не быстрее потолка МБ/с и встаёт на следующем блоке, когда он вернулся.
   */
  const startedAt = Date.now() - Math.round(process.uptime() * 1000);
  const busyWork = () => gameWriteBusy() || housekeepingHeld() || Boolean(quiet?.updatesBusy?.());
  const gate = createHousekeepingGate({
    startedAt,
    ...(quiet?.systemIdleMs ? { systemIdleMs: quiet.systemIdleMs } : {}),
    ...(quiet?.attention ? { attention: quiet.attention } : {}),
    busyWork,
    gameRunning,
    freeSpace: () => freeSpaceOf(nativeRestorePointsRoot()),
    /* Кладовая кусков — обычная фоновая работа, а не исключение: не быстрее потолка, но и не только когда человек отошёл. */
    settings: { yieldToUser: false, packBacklog: 1 },
  });
  const housekeeping = configureCacheHousekeeping({
    isBusy: () => gameWriteBusy() || housekeepingHeld(),
    gate,
    run: async ({ forced = false } = {}) => {
      const { stateDir } = await withInstallState();
      fingerprintsIn(stateDir);
      return tidyAstralCache({
        stateDir,
        restorePointsRoot: nativeRestorePointsRoot(),
        /* Хранилище ассетов Rust-движка рядом с кэшем Astral: то же место, что у канала окна (`wireWindowRequests`). */
        engineAssetsDir: path.join(path.dirname(stateDir), "engine-assets"),
        /* По ходу уступаем и человеку, и игре: проход встаёт на следующем блоке (кнопка «Очистить кэш» — только записи). */
        isBusy: forced ? gameWriteBusy : () => Boolean(gate.mustStop()),
        gameRunning,
        packAllowed: async ({ pending = 0 } = {}) => (await gate.mayPack({ force: forced, pending })).ok,
        /* «Очистить кэш» — всё, что накопилось, за один раз. */
        ...(forced ? { packPerRun: Number.POSITIVE_INFINITY } : {}),
        pace: forced ? null : gate.pace,
        onPacked: gate.markPacked,
      });
    },
    log: recordHousekeeping,
  });
  /*
   * Опись точек отката (шаг 1.1 ядра фазы 7): тот же планировщик простоя, что у уборки кэша,
   * и те же ворота. Выключено по умолчанию; включается флагом ASTRAL_CHAIN_INDEX=1.
   */
  const chainIndex = createChainIndexJob({
    /* Папка точек — на момент прохода: точки переезжают с кэшем. */
    root: () => nativeRestorePointsRoot(),
    gate,
    enabled: chainIndexEnabled(),
    gameRoots: async () => {
      const { stateDir } = await withInstallState();
      const profile = await inspectProfile({ stateDir }).catch(() => null);
      return Object.values(profile?.targets || {}).map((target) => target?.gameRoot);
    },
    log: (result, error) => {
      if (error) console.warn(`[astral] опись точек отката: ${error?.message || error}`);
    },
  });
  chainIndex.start();
  handleIpc(IPC.INSTALL_PROFILE, (event) =>
    trusted(event, () =>
      consolidatedProfile({ withInstallState, gtaSettingsStateDir }),
    ),
  );
  /*
   * Стоит ли поставленное в игре на самом деле — для библиотеки.
   *
   * Ответ не должен ломать экран: игру могли не найти, состояния может ещё
   * не быть, — тогда «неизвестно», и библиотека молчит. Состояние читается
   * `inspectProfile`, а не `getProfile`: восстановление незавершённой
   * транзакции пишет в игру и принадлежит мутирующим сценариям, а не
   * открытию вкладки.
   */
  handleIpc(IPC.LIBRARY_STATUS, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const game = await findGame(value.targetId).catch(() => null);
      const gameRoot = game?.gameRoot || game?.path || game?.root || "";
      if (!gameRoot) return { status: "unknown", reason: "no-game" };
      const state = await inspectProfile(await withInstallState()).catch(
        () => null,
      );
      /* «Моды при запуске игры» (задача 7): пока игра закрыта, в игре
         оригинал Rockstar, а моды ждут рядом — сверяется архив с модами. */
      const parked = await rockstarDelivery
        ?.parkedArchive(gameRoot)
        .catch(() => null);
      const delivery = rockstarDelivery
        ? await rockstarDelivery.modeOf(gameRoot).catch(() => "direct")
        : "direct";
      const status = await libraryInstallStatus({
        gameRoot,
        target: state?.targets?.[game.id] || null,
        restorePointsRoot: nativeRestorePointsRoot(),
        ...(parked ? { archivePath: parked } : {}),
      });
      /* Копия из Rockstar Games Launcher откатывает update.rpf при запуске
         (Т-98): «Библиотека» называет виновника своими словами. */
      return {
        ...status,
        rockstarLauncher: Boolean(game.rockstarLauncher),
        delivery,
        ...(parked ? { parked: true } : {}),
      };
    }),
  );
  handleIpc(IPC.RESET_TARGET, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const operationId = String(value.operationId || "")
        .replace(/[^a-z0-9._-]/gi, "")
        .slice(0, 120);
      delete value.operationId;
      if (operationId && activeOperations.has(operationId)) {
        throw new Error("This operation is already running.");
      }
      if (workshopBusy()) throw new Error(WORKSHOP_BUSY_MESSAGE);
      const controller = new AbortController();
      if (operationId) activeOperations.set(operationId, controller);
      const sendProgress = progressSender(event, IPC, operationId);
      let game = await findGame(value.targetId);
      const assertRuntimeSafety = async () => {
        game = await findGame(value.targetId);
        await assertInstallRuntimeSafe(game);
      };
      try {
        await assertRuntimeSafety();
        /* Замер по фазам (сброс 12.10, `reset-timing.js`). */
        let engineTimings = null;
        const result = await restoreOriginalTarget({
          ...(await withInstallState(value)),
          signal: controller.signal,
          assertRuntimeSafety,
          onProgress: sendProgress,
          /* Сначала — правки, сделанные после Astral (задача 1 ТЗ
             07.10.2026): возвращается сборка человека, а не прошлая копия. */
          contentXmlProvider: provideUpdateContentXml,
          dlcListProvider: provideLegacyDlcList,
          onTimings: (timings) => {
            engineTimings = timings;
          },
        });
        const laps = handlerLaps();
        /* Чужие загрузчики, отложенные подготовкой, — на место: игра как до Astral. */
        await returnParkedLoaders(game?.gameRoot || game?.path || game?.root || "").catch(() => []);
        /* Игра «до Astral»: точки работ мастерской больше ни к чему не ведут. */
        await forgetRestorePointsAfterReset(
          nativeRestorePointsRoot(),
          game?.gameRoot || game?.path || game?.root || "",
        ).catch(() => []);
        /* Работы пакетов (ЧБ-мир, дороги, растительность), что помнит главный процесс, — тоже: пакетов уже нет. */
        await forgetAllLayerWorks({
          stateDir: (await withInstallState()).stateDir,
          targetId: value.targetId,
        }).catch(() => 0);
        laps.lap("points");
        sendProgress({
          phase: "settings-reset",
          percent: 97,
          cancellable: false,
        });
        await resetSettingsTarget({
          targetId: value.targetId,
          settingsPath: gtaSettingsPath(),
          stateDir: await gtaSettingsStateDir(),
          signal: controller.signal,
          assertRuntimeSafety,
        });
        laps.lap("settings");
        const timings = {
          totalMs:
            (engineTimings?.totalMs || 0) +
            laps.phases.reduce((sum, item) => sum + item.ms, 0),
          phases: [...(engineTimings?.phases || []), ...laps.phases],
        };
        appLog.record({
          level: "info",
          source: "install",
          message: resetTimingLine({ engine: engineTimings, extra: laps.phases }),
        });
        sendProgress({
          phase: "complete",
          percent: 100,
          cancellable: false,
          timings,
        });
        return result;
      } finally {
        if (operationId) activeOperations.delete(operationId);
      }
    }),
  );

  /*
   * Сборка человека (задача 1 ТЗ 07.10.2026): установка отказала вопросом
   * «оставить своё или заменить» — окно берёт список спорных файлов отсюда
   * (ошибка через Electron доходит одной строкой) и пишет решение; повтор
   * той же работы его уже знает.
   */
  handleIpc(IPC.FOREIGN_CONFLICTS, (event) =>
    trusted(event, async () =>
      readPendingForeignConflicts({ stateDir: (await withInstallState()).stateDir }),
    ),
  );
  handleIpc(IPC.SET_FOREIGN_CHOICES, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const choices = (Array.isArray(value.choices) ? value.choices : [])
        .slice(0, 2000)
        .map((item) => ({
          archive: String(item?.archive || "update/update.rpf").slice(0, 260),
          entry: String(item?.entry || "").slice(0, 400),
          choice: item?.choice === "keep" ? "keep" : item?.choice === "replace" ? "replace" : "",
        }))
        .filter((item) => item.entry && item.choice);
      return setForeignChoices({
        stateDir: (await withInstallState()).stateDir,
        targetId: String(value.targetId || "default"),
        choices,
      });
    }),
  );

  /* Корзина библиотеки — вторая половина того же вопроса «что стоит в
     игре»: статус выше отвечает, что стоит, а эти каналы это снимают. */
  const removalDependencies = {
    findGame,
    withInstallState,
    installOptions,
    gtaSettingsPath,
    gtaSettingsStateDir,
    nativeContext,
  };
  registerLibraryRemovalIpc({
    ...removalDependencies,
    IPC,
    handleIpc: handleGameWrite,
    trusted,
    safeInput,
    operations,
    activeOperations,
  });
  /* «Что стоит в игре» (Т-170): список, сухой прогон, снятие любых вещей. */
  registerInstalledIpc({
    ...removalDependencies,
    IPC,
    handleIpc,
    handleGameWrite,
    trusted,
    safeInput,
    operations,
    activeOperations,
  });
  return {
    /* Удаление, оборванное закрытием приложения, доводится до того, как окно
       откроется и что-нибудь запишет в архив поверх отложенной копии. Уборка
       кэша — после него: оборванное удаление держит свои точки отката. */
    /* Итог — окну (startup-recovery.js): «вернули как было», «доделали»,
       «часть снята» или «не вышло». */
    recoverLibraryRemoval: () => {
      /* Папки игр ищутся один раз на запуск: их спрашивают и доводка журналов движка, и подмена архивов. */
      let found = null;
      const roots = () => (found ||= writableGameRoots({ withInstallState }).catch(() => []));
      /* Самое первое — оборванные записи движка в архивах игры: всё, что идёт дальше, читает архивы и должно видеть
         их целыми (`engine-journals.js`). Сбой доводки остальному восстановлению не мешает. */
      return settleJournalsOnStartup({ withInstallState, roots })
        .catch((error) => console.error("Astral engine journal settle failed", error))
        /* Затем — транзакции движка, оборванные прошлым запуском: окно читает
           профиль без восстановления (`install-profile-reader.js`). */
        .then(() => withInstallState())
        .then(({ stateDir }) => {
          /* Запись дозаписи в update.rpf, которую транзакция начала и не закончила, снимается по точке (`append-item.js`). */
          registerCatalogAppendRecovery({ stateDir });
          return recoverInterruptedTransactions({ stateDir });
        })
        .catch((error) => console.error("Astral engine transaction recovery failed", error))
        .then(() => recoverLibraryRemovalOnStartup(removalDependencies))
        .then(async (result) => {
          /* Подмена архива, оборванная посреди (свет, сбой, диспетчер
             задач), — игре возвращается целый архив (задача 1 ТЗ
             10.10.2026). После журналов движка и корзины: они знают свои
             отложенные копии сами. */
          await recoverInterruptedSwaps({ withInstallState, roots }).catch((error) =>
            console.error("Astral archive swap recovery failed", error),
          );
          /* Носитель update2.rpf (RP): регистрации без контейнеров в нём снимаются до игры (`carriers-start-guard.js`); без выключателя ASTRAL_CARRIERS ничего не читается. */
          /* Режим RP включает носитель сам, но ищет клиент RAGE MP по реестру: сторож ждёт, пока окружение готово. */
          await rpModeSettled();
          await guardCarriersAllGames().catch((error) => console.error("Astral carrier guard failed", error));
          return result?.recovered || null;
        })
        .catch((error) => {
          console.error("Astral library removal recovery failed", error);
          return "failed";
        })
        .finally(() => housekeeping.schedule());
    },
  };
}
