/*
 * Пересборка архивов, которые собрал прежний helper.
 *
 * До 26.09.2026 helper сжимал каждую двоичную запись. Для банка звука это
 * ошибка дважды: у самой игры банки AWC лежат несжатыми, а сжатый размер
 * пишется в 24-битное поле оглавления. Банк weapons.awc (19 МБ) переполнял
 * поле, и GTA V падала на загрузке с ERR_GEN_ZLIB_2 («Ошибка вызова zlib»):
 * архив RESIDENT.rpf у игрока уже испорчен, хотя мод «стоит».
 *
 * Слои модов при этом верны — неверна только сборка. Поэтому архив, в
 * котором стоят звуковые банки и который собран прежней формой записи
 * (`lastBuilt.format` ниже `COMPOSITE_FORMAT`), собирается заново из тех же
 * слоёв и подменяется одной транзакцией — с точкой отката, как любая
 * установка. Архив, который сменили мимо движка, не трогается: чужое поверх
 * себя движок молча не пересобирает.
 */

import { COMPOSITE_FORMAT, composeArchiveResource } from "./resource-composition.js";
import { timecycleCompositionNeedsBase } from "./timecycle-composition.js";
import { resolveInside, sha256File } from "./manifest.js";
import { exists, DEFAULT_DIR, statePaths } from "./storage-state.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import { readState, serializeMutation } from "./engine-state.js";
import { assertRuntimeSafe, throwIfAborted } from "./runtime-guard.js";
import { recoverPendingTransactions, transact } from "./transactions.js";
import { orderForCarriers } from "./carrier-order.js";

/* Записи, которые прежняя форма записи хранила не так, как игра. */
const RESTORED_ENTRY = /\.awc$/i;

/*
 * Падение 12.10.2026: сборка без сборщика таймцикла приложения клала в
 * timecycle_mods_*.xml одни модификаторы слоёв — без файла игры GTA V
 * падала на экране загрузки. Такая сборка (без отметки `timecycleOverBase`)
 * тоже собирается заново: слои верны, неверна только сборка.
 */
const timecycleWithoutBase = (archive) =>
  archive?.lastBuilt?.timecycleOverBase !== true &&
  Object.values(archive?.entries || {}).some((record) => {
    const layers = record?.layers || [];
    return (
      layers.at(-1)?.merge?.strategy === "timecycle-modifier-v1" &&
      timecycleCompositionNeedsBase(layers)
    );
  });

/** Архивы цели, которые надо собрать заново. */
export function staleCompositeArchives(target) {
  return Object.entries(target?.archives || {})
    .filter(([archiveTarget, archive]) => {
      if (!target.resources?.[archiveTarget]?.layers?.length) return false;
      if (timecycleWithoutBase(archive)) return true;
      if ((Number(archive?.lastBuilt?.format) || 0) >= COMPOSITE_FORMAT)
        return false;
      return Object.entries(archive?.entries || {}).some(
        ([entry, record]) =>
          RESTORED_ENTRY.test(entry) && (record?.layers || []).length > 0,
      );
    })
    .map(([archiveTarget]) => archiveTarget)
    .sort();
}

export async function refreshStaleComposites({
  targetId = "default",
  stateDir = DEFAULT_DIR,
  rpfComposer = null,
  signal = null,
  assertRuntimeSafety = null,
  onProgress = null,
  ...materializers
}) {
  return serializeMutation(async () => {
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    const target = ownRecordValue(current.targets, targetKey);
    if (!target) return { status: "missing", refreshed: [], skipped: [] };
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored")
      return { status: "suspended", refreshed: [], skipped: [] };
    const stale = staleCompositeArchives(target);
    if (!stale.length) return { status: "current", refreshed: [], skipped: [] };
    if (typeof rpfComposer !== "function")
      return { status: "no-helper", refreshed: [], skipped: stale };

    const next = structuredClone(current);
    const nextTarget = ownRecordValue(next.targets, targetKey);
    const paths = statePaths(stateDir);
    const affected = [];
    const skipped = [];
    for (const archiveTarget of stale) {
      throwIfAborted(signal);
      const livePath = resolveInside(nextTarget.gameRoot, archiveTarget);
      const expected = nextTarget.resources[archiveTarget].layers.at(-1)?.sha256;
      if (
        !expected ||
        !(await exists(livePath)) ||
        (await sha256File(livePath)) !== expected
      ) {
        skipped.push(archiveTarget);
        continue;
      }
      await assertRuntimeSafe(assertRuntimeSafety, signal, "before-refresh");
      const sourcePath = await composeArchiveResource({
        target: nextTarget,
        archiveTarget,
        targetKey,
        edition: nextTarget.edition,
        gameRoot: nextTarget.gameRoot,
        paths,
        rpfComposer,
        signal,
        assertRuntimeSafety,
        onProgress,
        ...materializers,
      });
      affected.push({ relativePath: archiveTarget, livePath, sourcePath });
    }
    if (!affected.length)
      return { status: "skipped", refreshed: [], skipped };
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-refresh-commit");
    await transact({
      stateDir,
      current,
      next,
      targetId: targetKey,
      affected: orderForCarriers(affected, "install"),
      action: "refresh-composites",
      signal,
    });
    return {
      status: "refreshed",
      refreshed: affected.map((item) => item.relativePath),
      skipped,
    };
  });
}
