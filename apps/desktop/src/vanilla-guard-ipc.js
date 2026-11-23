/*
 * Каналы install-engine вокруг цели: аудит, ремонт, точки восстановления и
 * ванильная сессия — приостановка модов, запуск игры, дозор до её выхода.
 *
 * Отдельный модуль по той же причине, что у установщика: `main.js` отвечает
 * за жизненный цикл окна, а не за хореографию suspend → launch → resume.
 * Дозор и восстановление сессий переезжают вместе с каналами — врозь они не
 * живут, — но карта дозоров и рассылка статуса остаются у `main.js` (их
 * читают before-quit и окна) и приходят параметрами. Регистрация возвращает
 * `recoverVanillaSessions`: старт приложения доводит прерванные сессии тем
 * же кодом, что и кнопка.
 */

import path from "node:path";
import { discoverGames } from "@modovik/game-discovery";
import {
  auditTarget,
  getVanillaGuardStatus,
  inspectProfile,
  listRestorePoints,
  repairTarget,
  restoreParkedMods,
  resumeTarget,
  restorePoint,
  suspendTarget,
} from "@modovik/install-engine";
import { ENTRY_MATERIALIZERS } from "./entry-materializers.js";
import {
  composeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { holdHousekeeping } from "./cache-housekeeping.js";
import { auditTailCheck } from "./rpf-tail.js";
import { hibernating, noteGameRunning } from "./hibernation-hooks.js";
import { healBeforeLaunch } from "./clothing-registration-heal.js";
import { runningGameProcesses } from "./legacy-runtime-guard.js";
import { appReduxTools } from "./redux-install.js";
import { guardCarriersBeforeLaunch, settleBeforeLaunch } from "./install-state-ipc.js";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/* Жив ли процесс: сигнал 0 ничего не шлёт, только спрашивает. EPERM — жив, но чужой. */
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function registerVanillaGuardIpc({
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
  env = process.env,
  tailCall = undefined,
  /* Движок «Починить»; подменяется только в тесте ответа окну (`tests/repair-ipc-patches-not-adopted.test.js`). */
  repair = repairTarget,
}) {
  async function launchDetectedGame(game) {
    if (game.store === "Steam") {
      await shell.openExternal("steam://rungameid/271590");
      return;
    }
    const executable = path.join(game.path, game.executable);
    const error = await shell.openPath(executable);
    if (error) throw new Error(error);
  }

  function watchVanillaSession(game) {
    if (vanillaWatchers.has(game.id)) return;
    const token = Symbol(game.id);
    vanillaWatchers.set(game.id, token);
    (async () => {
      const startupDeadline = Date.now() + 120_000;
      let processSeen = false;
      while (vanillaWatchers.get(game.id) === token) {
        const found = await runningGameProcesses(game);
        const running = found.length > 0;
        if (running && !processSeen) noteGameRunning("vanilla");
        if (running) processSeen = true;
        if (
          (processSeen && !running) ||
          (!processSeen && Date.now() > startupDeadline)
        )
          break;
        /*
         * Игра найдена — дальше её процесс спрашивается по номеру (02.11.2026): снимок `tasklist`
         * стоит ~0,4 с ЦП и шёл раз в 2 с всё время игры, рядом с самой GTA. Вопрос по номеру
         * ничего не запускает. Процессы вышли — один снимок ещё раз: не перезапустилась ли игра.
         */
        const pids = found.map((item) => item.pid).filter((pid) => Number.isInteger(pid) && pid > 0);
        if (pids.length) {
          while (vanillaWatchers.get(game.id) === token && pids.some(processAlive)) await delay(2_000);
          continue;
        }
        /* Окно спит — игра идёт: снимок процессов раз в минуту, моды вернутся не позже минуты после выхода. */
        await delay(hibernating() ? 60_000 : 2_000);
      }
      if (vanillaWatchers.get(game.id) !== token) return;
      vanillaWatchers.delete(game.id);
      try {
        const status = await resumeTarget(
          await withInstallState({ targetId: game.id }),
        );
        broadcastVanillaStatus({ ...status, reason: "game-exited" });
      } catch (error) {
        broadcastVanillaStatus({
          targetId: game.id,
          active: true,
          phase: "restore-conflict",
          error: error.message,
        });
      }
    })();
  }

  /* Итог по каждой игре — окну (startup-recovery.js): моды вернулись или нет. */
  async function recoverVanillaSessions() {
    const outcomes = [];
    const games = await discoverGames().catch(() => []);
    for (const game of games) {
      const status = await getVanillaGuardStatus(
        await withInstallState({ targetId: game.id }),
      ).catch(() => null);
      if (!status?.active) continue;

      const running = await gameProcessRunning(game);
      const startedAt = Date.parse(status.startedAt || "");
      const launchStillPending =
        Number.isFinite(startedAt) && Date.now() - startedAt < 120_000;

      if (running || launchStillPending) {
        watchVanillaSession(game);
        continue;
      }

      try {
        await resumeTarget(await withInstallState({ targetId: game.id }));
        outcomes.push({ targetId: game.id, resumed: true });
      } catch (error) {
        console.error("Astral Vanilla Guard recovery failed", error);
        outcomes.push({ targetId: game.id, failed: true });
      }
    }
    return outcomes;
  }

  handleIpc(IPC.AUDIT_TARGET, (event, input) =>
    trusted(event, async () => {
      const release = holdHousekeeping();
      try {
        /* Хвост носителей проверяется, только когда носитель включён (`ASTRAL_CARRIERS=update2`); без выключателя — проверка файлов как раньше (`tailCheck: null`). */
        return await auditTarget({ ...(await withInstallState(safeInput(input))), tailCheck: auditTailCheck(env, tailCall) });
      } finally {
        release();
      }
    }),
  );

  /* «Вернуть как было» пересобирает слои Astral поверх сборки человека,
     а не копирует прошлую сборку (задача 1 ТЗ 07.10.2026). */
  handleIpc(IPC.REPAIR_TARGET, (event, input) =>
    trusted(event, async () => {
      const options = await withInstallState(safeInput(input));
      const tools = {
        rpfComposer: composeRpfArchive,
        contentXmlProvider: provideUpdateContentXml,
        dlcListProvider: provideLegacyDlcList,
      };
      /* «Как было» после проверки файлов игры — это и снятые ею моды
         (задача 2 ТЗ 10.10.2026): сначала они встают обратно. */
      const profile = await inspectProfile({ stateDir: options.stateDir });
      if (profile?.targets?.[options.targetId]?.parked?.length)
        await restoreParkedMods({ ...options, ...tools, ...ENTRY_MATERIALIZERS });
      /* Установленные редуксы со слоем движка: dlc сверяются, потерянный уходит из установленного (`redux-install.js`). */
      /* Ответ движка идёт окну как есть: `adopted` и `patchesNotAdopted` (правки мастерской не приняты) читает «Настройки → Игра». */
      return repair({ ...options, ...tools, reduxRepairer: appReduxTools({ stateDir: options.stateDir }).reduxRepairer });
    }),
  );

  handleIpc(IPC.LIST_RESTORE_POINTS, (event, input) =>
    trusted(event, async () =>
      listRestorePoints(await withInstallState(safeInput(input))),
    ),
  );

  handleIpc(IPC.RESTORE_POINT, (event, input) =>
    trusted(event, async () =>
      /* Копии сборки точки в кэше может не быть («одна запись вместо двух»): тогда архив собирается заново. */
      restorePoint({ ...(await withInstallState(safeInput(input))), rpfComposer: composeRpfArchive }),
    ),
  );

  handleIpc(IPC.VANILLA_STATUS, (event, input) =>
    trusted(event, async () =>
      getVanillaGuardStatus(await withInstallState(safeInput(input))),
    ),
  );

  handleIpc(IPC.LAUNCH_VANILLA, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const game = await findGame(value.targetId);
      const status = await suspendTarget({
        gameRoot: game.path,
        targetId: game.id,
        edition: game.edition,
        ...(await withInstallState()),
      });
      broadcastVanillaStatus({ ...status, reason: "launching" });
      try {
        await settleBeforeLaunch({ game, withInstallState });
        await launchDetectedGame(game);
        watchVanillaSession(game);
        return { ...status, launched: true };
      } catch (error) {
        vanillaWatchers.delete(game.id);
        await resumeTarget(await withInstallState({ targetId: game.id })).catch(
          () => {},
        );
        throw error;
      }
    }),
  );

  handleIpc(IPC.LAUNCH_GAME, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const game = await findGame(value.targetId);
      /* Регистрация DLC одежды стёрта снаружи — вернуть до старта, чтобы игра смонтировала одежду (сбой запуск не останавливает). */
      await healBeforeLaunch(game);
      /* Оборванная запись движка в update.rpf (редукс, экспресс) — до старта игры. */
      await settleBeforeLaunch({ game, withInstallState });
      /* Носитель update2.rpf: регистрации без контейнеров в нём снимаются до старта игры (Н-2, `carriers-start-guard.js`); сбой запуск не останавливает. */
      await guardCarriersBeforeLaunch(game);
      await launchDetectedGame(game);
      return { targetId: game.id, launched: true };
    }),
  );

  handleIpc(IPC.RESTORE_VANILLA, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      vanillaWatchers.delete(String(value.targetId || ""));
      const status = await resumeTarget(await withInstallState(value));
      broadcastVanillaStatus({ ...status, reason: "manual" });
      return status;
    }),
  );

  return { recoverVanillaSessions };
}
