/*
 * «Вернуть GTA V без модов» и возврат к чистой базе: файлы игры — к копиям
 * «до Astral» одной транзакцией, состояние цели — без модов (Т-87, Т-162).
 *
 * Вынесено из `index.js` вместе с замером фаз (сброс 12.10): что сброс делать
 * не обязан, решает `reset-plan.js`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  originalRestoreBaseline,
  settleResourceAfterRestore,
} from "./pristine-baseline.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import { DEFAULT_DIR, exists, statePaths } from "./storage-state.js";
import { resolveInside } from "./manifest.js";
import { assertRuntimeSafe } from "./runtime-guard.js";
import {
  assertAbsoluteInside,
  readState,
  serializeMutation,
} from "./engine-state.js";
import { ensureBaseFile } from "./base-recovery.js";
import { adoptOutsideChanges } from "./target-repair.js";
import { planOriginalRestore } from "./reset-plan.js";
import { noteLiveBefore } from "./engine-steps.js";
import { recoverPendingTransactions, transact } from "./transactions.js";
import { pruneEmptyManagedDirectories } from "./fs-guards.js";
import { releaseStalePacks, settleStaleManagedDlc } from "./stale-managed-dlc.js";
import { readPackedManifest } from "./chunk-store.js";
import { orderForCarriers } from "./carrier-order.js";
import { pruneEmptySubpackResources } from "./subpack-closure.js";

/* Отказ возврата: оригинал собирался из кусков и живого архива, а живой архив изменили снаружи. Игра не тронута; `installFailure.js` даёт подсказку на всех языках. */
export const ORIGINAL_UNAVAILABLE = "ASTRAL_ORIGINAL_UNAVAILABLE";
const originalUnavailable = (relativePath) =>
  Object.assign(
    new Error(
      `Оригинал ${relativePath} не собрать: файл игры изменили снаружи, а кусков, которых в нём больше нет, у Astral нет. Игра не тронута. Проверьте файлы игры в Steam, Rockstar Games Launcher или Epic Games и повторите.`,
    ),
    { code: ORIGINAL_UNAVAILABLE, archive: relativePath },
  );

/*
 * Копия, к которой возвращается файл игры. Отпечаток копии сверяется по
 * дороге в игру — тем же чтением, что и копирование (`transaction.js`,
 * `item.sha256`), — а не отдельным чтением до него (сброс 12.10: два с лишним
 * гигабайта лишнего чтения на каждом сбросе). Повреждённая копия так же
 * обрывает возврат до подмены: игра остаётся, какой была.
 */
async function resolveBaselineSource({ resource, relativePath, mode, paths }) {
  const baseline =
    mode === "original"
      ? originalRestoreBaseline(resource)
      : mode === "clean"
        ? resource.clean
        : null;
  if (!baseline) throw new Error(`Неизвестный режим восстановления: ${mode}.`);
  if (mode === "clean" && baseline.verified === false) {
    throw new Error(
      `Чистая база не подтверждена для ${relativePath}. Сначала выполните проверку файлов GTA V.`,
    );
  }
  if (!baseline.exists) return null;
  const sourcePath = assertAbsoluteInside(paths.bases, baseline.path);
  if (!(await exists(sourcePath))) {
    if (await readPackedManifest(sourcePath)) throw originalUnavailable(relativePath);
    throw new Error(`Файл базы восстановления недоступен: ${relativePath}`);
  }
  const sha256 = /^[0-9a-f]{64}$/i.test(String(baseline.sha256 || ""))
    ? String(baseline.sha256).toLowerCase()
    : "";
  return { sourcePath, sha256 };
}

/* Замер фаз сброса (сброс 12.10): сколько заняла каждая часть — в журнал
   приложения и последним событием прогресса. */
function phaseClock() {
  const started = Date.now();
  let last = started;
  const phases = [];
  return {
    mark(phase, extra = {}) {
      const now = Date.now();
      phases.push({ phase, ms: now - last, ...extra });
      last = now;
    },
    report: () => ({ totalMs: Date.now() - started, phases }),
  };
}

export async function restoreTargetBaseline({
  targetId = "default",
  stateDir = DEFAULT_DIR,
  mode,
  signal = null,
  assertRuntimeSafety = null,
  onProgress = null,
  contentXmlProvider = null,
  dlcListProvider = null,
  /* `({ totalMs, phases: [{ phase, ms, … }] })` — замер фаз (сброс 12.10). */
  onTimings = null,
}) {
  return serializeMutation(async () => {
    const clock = phaseClock();
    onProgress?.({ phase: "prepare", percent: 6, cancellable: true });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-reset");
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const next = structuredClone(current);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    const target = ownRecordValue(next.targets, targetKey);
    if (!target) throw new Error("Игровой профиль не найден.");
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored")
      throw new Error(
        "Сначала завершите сеанс Vanilla Guard и восстановите профиль.",
      );
    const paths = statePaths(stateDir);
    clock.mark("state");
    onProgress?.({ phase: "verify", percent: 20, cancellable: true });
    /*
     * Что возврату делать незачем (сброс 12.10, `reset-plan.js`): архив уже
     * «до Astral» — ни основы, ни копии; update.rpf собран самим Astral —
     * его правки в основу не принимаются (возврат кладёт копию, снятую до
     * них). Чужая правка принимается, как раньше: возвращается сборка
     * человека.
     */
    const plan =
      mode === "original"
        ? await planOriginalRestore({ target, signal })
        : { settled: new Set(), skipAdoption: new Set(), live: new Map() };
    if (plan.skipAdoption.has("update/update.rpf"))
      /* Звено истории (`engine-steps.js`) — с какого архива сброс начался:
         без перебазирования его называет план. */
      noteLiveBefore({
        bases: paths.bases,
        targetKey,
        sha256: plan.live.get("update/update.rpf"),
      });
    const adopted =
      mode === "original"
        ? await adoptOutsideChanges({
            target,
            paths,
            targetKey,
            contentXmlProvider,
            dlcListProvider,
            signal,
            skip: plan.skipAdoption,
          })
        : [];
    /* Принятая сборка человека бывает ровно живым архивом (игру обновили,
       своего в ней нет): возвращать нечего — он уже «до Astral». */
    for (const relativePath of adopted) {
      const goal = originalRestoreBaseline(target.resources?.[relativePath]);
      const liveSha = plan.live.get(relativePath);
      if (goal?.exists && liveSha && String(goal.sha256 || "").toLowerCase() === liveSha)
        plan.settled.add(relativePath);
    }
    clock.mark("adopt", {
      settled: plan.settled.size,
      skipped: plan.skipAdoption.size,
      adopted: adopted.length,
    });
    /* Оригинал кусками есть, но не собирается (живой архив правили на месте): отказ до
       всякой перемены. Иначе ниже основой стал бы живой архив, а человек получил бы вместо
       «без модов» игру с чужой правкой. Архив, уже равный оригиналу, не собирается вовсе. */
    if (mode === "original")
      for (const [relativePath, resource] of Object.entries(target.resources || {})) {
        if (plan.settled.has(relativePath)) continue;
        const goal = originalRestoreBaseline(resource);
        if (!goal?.exists || !goal.path || !(await readPackedManifest(goal.path))) continue;
        if (!(await exists(goal.path))) throw originalUnavailable(relativePath);
      }
    /* Копии основ пропали из кэша — основой становится живой архив
       (`base-recovery.js`), и возврат идёт к ней, а не обрывается. */
    for (const relativePath of Object.keys(target.resources || {}))
      if (target.archives?.[relativePath])
        await ensureBaseFile({
          target,
          archiveTarget: relativePath,
          paths,
          targetKey,
          signal,
        });
    /* Следы управляемых DLC в newmods, о которых состояние забыло, возвращаются вместе со всем (`stale-managed-dlc.js`):
       иначе «без модов» оставляло бы игре пакет и строку в списке. Отказ чистки возврат не останавливает. */
    const staleManaged =
      mode === "original"
        ? await settleStaleManagedDlc({
            target,
            targetKey,
            root: target.gameRoot,
            paths,
            edition: target.edition,
            dlcListProvider,
          }).catch(() => ({ affected: [], stale: null }))
        : { affected: [], stale: null };
    const affected = [];
    let copyBytes = 0;
    for (const [relativePath, resource] of Object.entries(
      target.resources || {},
    )) {
      const livePath = resolveInside(target.gameRoot, relativePath);
      /* Уже «до Astral»: те же байты не переписываются, а копию незачем и собирать. */
      if (plan.settled.has(relativePath)) continue;
      const source = await resolveBaselineSource({
        resource,
        relativePath,
        mode,
        paths,
      });
      if (!source) {
        if (!(await exists(livePath))) continue;
        affected.push({ relativePath, livePath, sourcePath: null });
        continue;
      }
      copyBytes += (await fs.stat(source.sourcePath)).size;
      affected.push({
        relativePath,
        livePath,
        sourcePath: source.sourcePath,
        ...(source.sha256
          ? {
              sha256: source.sha256,
              mismatch: `Файл базы восстановления повреждён: ${relativePath}`,
            }
          : {}),
      });
    }
    /* Пакеты без записи в состоянии удаляются; список newmods, если он в состоянии, возвращает цикл выше. */
    for (const item of staleManaged.affected)
      if (!affected.some((own) => own.relativePath === item.relativePath)) affected.push(item);
    releaseStalePacks(target, staleManaged.stale);
    /* Свои пакеты в `update/x64/dlcpacks/astral_*` (текстуры, растительность, дороги…), о которых состояние забыло:
       игра без модов их не держит, а строка в списке без них — «пакет не найден». Без записи их не видел ни один шаг выше. */
    if (mode === "original")
      for (const relativePath of await strayOwnDlcHosts(target.gameRoot))
        if (!affected.some((own) => own.relativePath === relativePath))
          affected.push({ relativePath, livePath: resolveInside(target.gameRoot, relativePath), sourcePath: null });
    clock.mark("bases", { files: affected.length });
    for (const resource of Object.values(target.resources || {}))
      settleResourceAfterRestore(resource, mode);
    for (const archive of Object.values(target.archives || {})) {
      for (const entry of Object.values(archive.entries || {}))
        entry.layers = [];
      delete archive.lastBuilt;
    }
    /* Подпакет штатного пакета (`dlc<N>.rpf`): файла «до Astral» не было, он удалён выше (`sourcePath: null`) — записи о нём в состоянии больше нет, как до установки (`subpack-closure.js`). */
    pruneEmptySubpackResources(target, Object.keys(target.resources || {}));
    /* Хост своего пакета, которого «до Astral» не было, возвращён удалением: записи о нём в состоянии больше нет
       (иначе сброс оставлял «пакет текстур стоит» и ресурсы на пустое место). */
    if (mode === "original")
      for (const relativePath of Object.keys(target.resources || {})) {
        if (!ASTRAL_DLC_HOST_PATTERN.test(relativePath)) continue;
        if (originalRestoreBaseline(target.resources[relativePath])?.exists) continue;
        delete target.resources[relativePath];
        delete target.archives?.[relativePath];
      }
    target.dlcRegistrations = {};
    target.directDlcRegistrations = {};
    target.fastWeaponDlc = null;
    target.clothingDlc = null;
    target.installed = [];
    target.parked = [];
    target.baselineMode = mode;
    const restoredAt = new Date().toISOString();
    target.lastGlobalRestore = { mode, restoredAt };
    target.stockHold = { mode, since: restoredAt }; // stock-hold.js, Т-87
    onProgress?.({
      phase: "ready-to-commit",
      percent: 28,
      cancellable: true,
    });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-reset-commit");
    onProgress?.({ phase: "commit", percent: 30, cancellable: false });
    const result = await transact({
      stateDir,
      current,
      next,
      targetId,
      affected: orderForCarriers(affected, "remove"),
      action: mode === "clean" ? "reset-clean" : "restore-original",
      signal,
      /* Байты копий «до Astral» — самая долгая часть сброса, и полоса идёт
         по ним (30 → 94 %), а не стоит на одном месте (сброс 12.10). */
      onStaging: onProgress
        ? ({ copiedBytes, totalBytes }) =>
            onProgress({
              phase: "commit",
              percent:
                30 +
                Math.floor(
                  (64 * Math.min(copiedBytes, totalBytes)) /
                    Math.max(1, totalBytes),
                ),
              cancellable: false,
              copiedBytes,
              totalBytes,
            })
        : null,
      onPrepared: () => clock.mark("copy", { bytes: copyBytes }),
      onCommitted: () => clock.mark("swap"),
    });
    clock.mark("cleanup");
    await pruneEmptyManagedDirectories(
      target.gameRoot,
      affected.map((item) => item.relativePath),
    );
    await pruneEmptyAstralDlcDirectories(
      target.gameRoot,
      affected.map((item) => item.relativePath),
    );
    const timings = clock.report();
    onTimings?.(timings);
    onProgress?.({
      phase: "finalizing",
      percent: 99,
      cancellable: false,
      timings,
    });
    return result;
  });
}

// Хосты DLC Astral (`update/x64/dlcpacks/astral_*/dlc.rpf`) живут в
// собственных папках, которых у оригинальной игры нет. После возврата
// оригинала пустая папка без dlc.rpf — мусор, который игра не читает, а
// человек принимает за «Astral не удалился».
const ASTRAL_DLC_HOST_PATTERN =
  /^update\/x64\/dlcpacks\/astral_[a-z0-9_]+\/dlc\.rpf$/i;
/* Хосты своих пакетов, что лежат в игре: `update/x64/dlcpacks/astral_*` с обычным файлом dlc.rpf. */
async function strayOwnDlcHosts(gameRoot) {
  const folder = resolveInside(gameRoot, "update/x64/dlcpacks");
  let names;
  try {
    names = await fs.readdir(folder);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return [];
    throw error;
  }
  const found = [];
  for (const name of names) {
    const relativePath = `update/x64/dlcpacks/${name}/dlc.rpf`;
    if (!ASTRAL_DLC_HOST_PATTERN.test(relativePath)) continue;
    const stat = await fs.lstat(resolveInside(gameRoot, relativePath)).catch(() => null);
    if (stat?.isFile() && !stat.isSymbolicLink()) found.push(relativePath);
  }
  return found.sort();
}
async function pruneEmptyAstralDlcDirectories(gameRoot, relativePaths) {
  const root = path.resolve(gameRoot);
  for (const relativePath of relativePaths) {
    if (!ASTRAL_DLC_HOST_PATTERN.test(relativePath)) continue;
    const directory = path.dirname(resolveInside(root, relativePath));
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      await fs.rmdir(directory);
    } catch (error) {
      if (
        !["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(
          error.code,
        )
      )
        throw error;
    }
  }
}
