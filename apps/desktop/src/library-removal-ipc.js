import fs from "node:fs/promises";
import path from "node:path";
import { inspectProfile, restoreParkedMods } from "@modovik/install-engine";
import { discoverGames } from "@modovik/game-discovery";
import { appLog } from "./app-log.js";
import { assertInstallRuntimeSafe, inspectInstallRuntime } from "./install-safety.js";
import { provisionAstralLayer } from "./astral-layer-provisioner.js";
import { healEngineLayer } from "./engine-layer-heal.js";
import {
  archiveFingerprint,
  engineAbsorbedEntries,
  engineWorkOver,
  engineModEntries,
  engineUpdateBase,
  engineUpdateExpected,
} from "./library-status.js";
import {
  LIBRARY_REMOVAL_JOURNAL,
  planLibraryRemoval,
  recoverLibraryRemoval,
  removeLibraryItems,
  retireLibraryItems,
} from "./library-removal.js";
import {
  canonicalPlace,
  nativeRestorePointsRoot,
} from "./native-restore-chain.js";
/* `catalog-uninstall.js` тянет редакторы звука и эффектов (~1,4 МБ исходников): грузится на первом снятии, а не на старте (30.10.2026). */
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { callNativeEngine, withGameArchives } from "./native-engine.js";
import { recomposePatch } from "./patch-recompose.js";
import { getSettingsInstallProfile } from "./settings-package.js";
import { reinstallAfterRestore, reinstallRequest } from "./library-reinstall.js";
import { groupTwoEngineRestore } from "./group-two-engine.js";
import { forgetRemovedWorks, rebuildAfterRemoval, rebuildArenaOverMods } from "./layer-works.js";
import { isRoadsModId } from "@modovik/install-engine/roads-manifest-trust.js";
import { isTexturesModId } from "@modovik/install-engine/textures-manifest-trust.js";
import { isVegetationModId } from "@modovik/install-engine/vegetation-ids.js";
import { resolvePatchDirectory } from "./library-removal.js";
import {
  composeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { ENTRY_MATERIALIZERS } from "./entry-materializers.js";

/*
 * Каналы корзины библиотеки.
 *
 * Сама логика — в `library-removal.js` и проверяется без Electron; здесь
 * только то, чем её снабжает приложение: где лежат точки отката, как хост
 * ставит патч, как движок снимает мод и что сейчас записано в его состоянии.
 * Регистрация принимает всё параметрами, как соседние модули каналов.
 */

const journalPath = () =>
  path.join(path.dirname(nativeRestorePointsRoot()), LIBRARY_REMOVAL_JOURNAL);
const squashJournalPath = () =>
  path.join(path.dirname(nativeRestorePointsRoot()), "squash-journal.json");

/*
 * Какой игре адресовано удаление.
 *
 * Библиотека знает выбранную игру (`targetId`), редактор — папку, в которую
 * ставил (`gameRoot`), а откат из редактора — только имя точки, и папку игры
 * тогда называет сама точка: хост записывает её в манифест. Игра в любом
 * случае должна быть найдена Astral — без неё не проверить, что она закрыта.
 */
async function resolveGame(value, findGame) {
  if (value?.targetId) return findGame(value.targetId);
  let root = typeof value?.gameRoot === "string" ? value.gameRoot : "";
  if (!root) {
    const pointId = String(value?.natives?.[0]?.restorePointId || "");
    if (/^[A-Za-z0-9_-]{1,80}$/.test(pointId)) {
      const manifest = JSON.parse(
        await fs
          .readFile(
            path.join(nativeRestorePointsRoot(), pointId, "restore.json"),
            "utf8",
          )
          .catch(() => "null"),
      );
      root = typeof manifest?.gameRoot === "string" ? manifest.gameRoot : "";
    }
  }
  const games = await discoverGames();
  if (!root) {
    /* Окно не назвало игру, а точка её не записала (точки эффектов и наборов
       движка — не точки хоста): одна найденная Legacy — однозначно она. */
    const legacy = games.filter((game) => String(game.edition || "Legacy").toLowerCase() === "legacy");
    if (legacy.length === 1) return legacy[0];
    throw new Error("Не удалось определить, из какой GTA V удалять.");
  }
  const place = await canonicalPlace(root);
  for (const game of games) {
    if ((await canonicalPlace(game.path)) === place) return game;
  }
  throw new Error(
    "Папка GTA V не найдена Astral. Выполните повторное сканирование игр.",
  );
}

export function removalTools({
  game,
  stateDir,
  withInstallState,
  gtaSettingsPath,
  gtaSettingsStateDir,
  nativeContext,
  operations = null,
  findGame,
}) {
  const engineState = async () =>
    (await inspectProfile(await withInstallState()))?.targets?.[game.id] ||
    null;
  return {
    /* Состояние движка и «можно ли менять игру сейчас» — для «Что стоит в игре» (Т-170). */
    readEngineState: engineState,
    guard: async () => inspectInstallRuntime(await findGame(game.id)),
    restorePointsRoot: nativeRestorePointsRoot(),
    journalPath: journalPath(),
    squashJournalPath: squashJournalPath(),
    stateDir,
    fingerprint: (file) => archiveFingerprint(file),
    engineTarget: async () => {
      const target = await engineState();
      const settings = await getSettingsInstallProfile({
        stateDir: await gtaSettingsStateDir(),
      }).catch(() => []);
      return {
        expected: engineUpdateExpected(target),
        /* Основа движка — ступень стопки мастерской (Т-107). */
        base: engineUpdateBase(target),
        modEntries: engineModEntries(target),
        absorbedEntries: engineAbsorbedEntries(target),
        workOver: engineWorkOver(target),
        installed: [
          ...(target?.installed || []).map((item) => item.modId),
          ...settings
            .filter((item) => item.targetId === game.id)
            .map((item) => item.modId),
        ],
        vanillaGuardActive: Boolean(
          target?.vanillaGuard && target.vanillaGuard.phase !== "restored",
        ),
      };
    },
    engineExpected: async () => engineUpdateExpected(await engineState()),
    /* Моды каталога поверх перемотанных работ мастерской встают обратно
       той же пересборкой, что у подготовки игры (Т-107). */
    recomposeEngine: async (options = {}) => {
      const result = await provisionAstralLayer({
        ...options,
        gameRoot: game.path,
        targetId: game.id,
        edition: game.edition,
        stateDir,
        assertRuntimeSafety: async () =>
          assertInstallRuntimeSafe(await findGame(game.id)),
      });
      /* Что вернула подготовка слоя после перемотки (14.11.2026): следующий журнал тестера покажет, пересобирал ли движок архив или ушёл быстрым путём. */
      appLog.record({
        level: "info",
        source: "install",
        message: `пересборка слоя движка после перемотки: подготовка слоя вернула ${result?.status || "?"}, изменён: ${result?.changed ? "да" : "нет"}`,
      });
      return result;
    },
    validatePatch: (patch) =>
      callNativeEngine("validate-rpf-patch", { patch }, nativeContext()),
    /* Работа, у которой есть записка пересборки, возвращается собранной
       заново поверх перемотанного архива (`patch-recompose.js`). */
    recomposePatch: async (patch) => {
      const fresh = await recomposePatch(patch, {
        gameRoot: game.path,
        stateDir,
        context: nativeContext(),
      });
      if (!fresh) return null;
      await callNativeEngine(
        "validate-rpf-patch",
        { patch: fresh.patch },
        nativeContext(),
      );
      return fresh;
    },
    installPatch: async ({ patch, gameRoot }) => {
      const support = await provisionArchiveSupport({ stateDir });
      return callNativeEngine(
        "install-rpf-patch",
        {
          patch,
          gameRoot,
          archiveFix: path.join(support.directory, "ArchiveFix.exe"),
          keys: support.directory,
        },
        nativeContext(),
      );
    },
    uninstallMod: async (modId, onProgress) =>
      (await import("./catalog-uninstall.js")).uninstallCatalogMod({
        modId,
        targetId: game.id,
        stateDir,
        gameRoot: game.path,
        settingsPath: gtaSettingsPath(),
        settingsStateDir: await gtaSettingsStateDir(),
        assertRuntimeSafety: async () =>
          assertInstallRuntimeSafe(await findGame(game.id)),
        onProgress,
      }),
    statfs: fs.statfs,
    lock: withGameArchives,
    /* Закрытая игра и свободный лаунчер — перед каждым шагом, а не один раз:
       операция идёт минуты, и игру успевают запустить посреди неё. */
    assertRuntimeSafety: async () =>
      assertInstallRuntimeSafe(await findGame(game.id)),
    report: (status) => operations?.report(status),
    /* Уборка прежней версии не пошла глубоко в стопку — след в журнале: без
       него «Применить» с оставшейся прежней версией выглядит как недоделка. */
    onRetireSkipped: ({ restorePointIds, replays }) =>
      appLog.record({
        level: "info",
        source: "install",
        message: `замена прежней версии пропущена: под ней ${replays} работ, переставлять их слишком долго; точка ${restorePointIds.join(", ")} остаётся в стопке`,
      }),
  };
}

const request = (value) => ({
  natives: Array.isArray(value?.natives) ? value.natives : [],
  mods: Array.isArray(value?.mods) ? value.mods : [],
});

export function registerLibraryRemovalIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  findGame,
  withInstallState,
  installOptions,
  gtaSettingsPath,
  gtaSettingsStateDir,
  nativeContext,
  operations,
  activeOperations,
}) {
  /* Слой движка после перестановки работ: чего движок не вернул — пересобираем (`engine-layer-heal.js`). Сбой сверки уборку не ломает. */
  const healAfter = async (game, tools, reason) => {
    try {
      await healEngineLayer({
        gameRoot: game.path,
        targetId: game.id,
        edition: game.edition,
        stateDir: tools.stateDir,
        reason,
        assertRuntimeSafety: async () => assertInstallRuntimeSafe(await findGame(game.id)),
      });
    } catch (error) {
      appLog.record({ level: "warn", source: "install", message: `сверка слоя движка после ${reason} не вышла: ${String(error?.message || error).split("\n")[0]}` });
    }
  };

  const toolsFor = async (value) => {
    const game = await resolveGame(value, findGame);
    const { stateDir } = await installOptions();
    return {
      game,
      tools: removalTools({
        game,
        stateDir,
        withInstallState,
        gtaSettingsPath,
        gtaSettingsStateDir,
        nativeContext,
        operations,
        findGame,
      }),
    };
  };

  handleIpc(IPC.LIBRARY_PLAN_REMOVAL, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const { game, tools } = await toolsFor(value);
      return planLibraryRemoval(
        { gameRoot: game.path, ...request(value) },
        tools,
      );
    }),
  );

  /*
   * Пакеты поверх снятых работ (дороги, ступень текстур, растительность)
   * собираются заново здесь же, без окна (`layer-works.js`, задача 3 ТЗ
   * 10.10.2026): иначе снятый облик оставался в игре издалека, если у окна не
   * было своей записи. Отказ пересборки снятие не отменяет — он в ответе.
   */
  const withRebuiltAfterRemoval = async (result, game, tools) => {
    const removed = (result?.mods || []).filter((item) => ["remove", "missing"].includes(item?.action)).map((item) => item.modId);
    if (!removed.length) return result;
    const { stateDir } = await installOptions();
    /* Работы снятых пакетов главному процессу больше не нужны (задача 10: оставались на диске). */
    await forgetRemovedWorks({ stateDir, targetId: game.id, removed }).catch(() => 0);
    const profile = await inspectProfile({ stateDir }).catch(() => null);
    const rebuilt = await rebuildAfterRemoval({
      stateDir,
      targetId: game.id,
      gameRoot: game.path,
      removed,
      installed: profile?.targets?.[game.id]?.installed || [],
      owners: { roads: isRoadsModId, textures: isTexturesModId, vegetation: isVegetationModId },
      assertRuntimeSafety: tools.assertRuntimeSafety,
      /* Пока идёт пересборка поверх снятого (минуты), окно называет её словами, а не стоит на шаге «Подготовка» (22.11.2026). */
      onStage: (stage) => operations?.report({ dependent: { ...stage, base: "removal" } }),
    }).catch((error) => ({ dependentFailures: [{ set: "vegetation", message: String(error?.message || error) }] }));
    /* Сняли мод арены, поверх которого собрана работа арены, — она
       собирается заново из игры (16.10). */
    const arenas = await rebuildArenaOverMods({
      stateDir,
      targetId: game.id,
      gameRoot: game.path,
      removed,
      assertRuntimeSafety: tools.assertRuntimeSafety,
      onStage: (stage) => operations?.report({ dependent: { ...stage, base: "removal" } }),
    }).catch((error) => ({ failure: { set: "arenas", message: String(error?.message || error) } }));
    const merged = arenas?.failure
      ? { ...(rebuilt || {}), dependentFailures: [...(rebuilt?.dependentFailures || []), arenas.failure] }
      : arenas
        ? { ...(rebuilt || {}), arenas }
        : rebuilt;
    return merged ? { ...result, rebuilt: merged } : result;
  };

  handleIpc(IPC.LIBRARY_REMOVE, (event, input) =>
    trusted(event, async () => {
      /* Очередь загрузок пишет в тот же архив своим движком: пока в ней
         что-то идёт, корзина ждёт, а не перематывает архив из-под неё. */
      if (activeOperations?.size)
        throw new Error(
          "Дождитесь окончания установок и удалений в очереди загрузок.",
        );
      const value = safeInput(input);
      const { game, tools } = await toolsFor(value);
      const result = await removeLibraryItems(
        { gameRoot: game.path, targetId: game.id, ...request(value) },
        tools,
      );
      const rebuilt = await withRebuiltAfterRemoval(result, game, tools);
      await healAfter(game, tools, "удаления из библиотеки");
      return rebuilt;
    }),
  );

  /* «Установить снова» после проверки файлов игры (задача 2 ТЗ 10.10.2026):
     снятые моды движка и работы хоста — одной операцией. */
  handleIpc(IPC.LIBRARY_REINSTALL, (event, input) =>
    trusted(event, async () => {
      if (activeOperations?.size)
        throw new Error(
          "Дождитесь окончания установок и удалений в очереди загрузок.",
        );
      const value = safeInput(input);
      const { game, tools } = await toolsFor(value);
      const { stateDir } = await installOptions();
      return reinstallAfterRestore(
        { gameRoot: game.path, ...reinstallRequest(value) },
        {
          ...tools,
          restoreEngine: async () => {
            const profile = await inspectProfile({ stateDir });
            if (!profile?.targets?.[game.id]?.parked?.length) return { restored: [], lost: [] };
            return restoreParkedMods({
              targetId: game.id,
              stateDir,
              rpfComposer: composeRpfArchive,
              contentXmlProvider: provideUpdateContentXml,
              dlcListProvider: provideLegacyDlcList,
              assertRuntimeSafety: tools.assertRuntimeSafety,
              /* Работа группы 2, поставленная движком (флаг `ASTRAL_ENGINE_INSTALL`), переигрывается из записи. */
              engineRestore: groupTwoEngineRestore(stateDir),
              ...ENTRY_MATERIALIZERS,
            });
          },
          resolvePatch: (patch) => resolvePatchDirectory(patch, stateDir),
        },
      );
    }),
  );

  handleIpc(IPC.LIBRARY_RETIRE, (event, input) =>
    trusted(event, async () => {
      if (activeOperations?.size)
        throw new Error(
          "Дождитесь окончания установок и удалений в очереди загрузок.",
        );
      const value = safeInput(input);
      const { game, tools } = await toolsFor(value);
      const outcome = await retireLibraryItems(
        {
          gameRoot: game.path,
          natives: request(value).natives,
          successor: value.successor,
        },
        tools,
      );
      logRetireOutcome(outcome, value.successor?.restorePointId);
      await healAfter(game, tools, "замены прежней версии");
      return outcome;
    }),
  );
}

/*
 * Что сделала замена прежней версии — в журнал (бета 15.10, kevake: после
 * второго «Применить» эффектов замена шла 67 с, трассеры остались штатными,
 * а в журнале было только «готово за 66,7 с»).
 */
function logRetireOutcome(outcome, successorId = "") {
  const actions = {};
  for (const item of outcome?.natives || []) actions[item.action] = (actions[item.action] || 0) + 1;
  const lost = (outcome?.lost || []).map((item) => `${item.restorePointId}: ${item.message || "?"}`);
  const moved = Object.keys(outcome?.remap || {}).length;
  const again = (outcome?.reapplied || []).includes(successorId);
  appLog.record({
    level: lost.length ? "warn" : "info",
    source: "install",
    message:
      `замена прежней версии: ${Object.entries(actions).map(([action, count]) => `${action} ${count}`).join(", ") || "нечего менять"}` +
      `; переставлено работ: ${moved}${again ? "; новая версия поставлена заново" : ""}` +
      (lost.length ? `; не встали: ${lost.join("; ")}` : ""),
  });
}

/**
 * Доводит удаление, оборванное закрытием приложения, до того как окно
 * откроется и кто-нибудь запишет в архив поверх отложенной копии.
 */
export async function recoverLibraryRemovalOnStartup({
  findGame,
  withInstallState,
  installOptions,
  gtaSettingsPath,
  gtaSettingsStateDir,
  nativeContext,
}) {
  let journal;
  try {
    journal = JSON.parse(await fs.readFile(journalPath(), "utf8"));
  } catch {
    return null;
  }
  const game = await findGame(journal?.targetId).catch(() => null);
  const { stateDir } = await installOptions();
  const tools = removalTools({
    game: game || { id: String(journal?.targetId || "default") },
    stateDir,
    withInstallState,
    gtaSettingsPath,
    gtaSettingsStateDir,
    nativeContext,
    findGame,
  });
  return recoverLibraryRemoval(tools);
}
