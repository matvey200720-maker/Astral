/*
 * Состояние «Вернуть без модов» (Vanilla Guard) цели: идёт ли оно, на какой фазе, что уже перенесено. Только чтение состояния.
 * Вынесено из `index.js` (лимит строк файла, `scripts/verify-web-architecture.js`) без изменений поведения; `index.js` отдаёт его тем же именем.
 */
import { DEFAULT_DIR } from "./storage-state.js";
import { readState } from "./engine-state.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";

export async function getVanillaGuardStatus({
  targetId = "default",
  stateDir = DEFAULT_DIR,
} = {}) {
  const state = await readState(stateDir);
  const targetKey = checkedRecordKey(targetId, "Target ID");
  const target = ownRecordValue(state.targets, targetKey);
  const guard = target?.vanillaGuard || null;
  return {
    targetId,
    active: Boolean(guard && guard.phase !== "restored"),
    phase: guard?.phase || "inactive",
    startedAt: guard?.startedAt || null,
    moved: Array.isArray(guard?.items)
      ? guard.items.filter((item) => item.moved).map((item) => item.source)
      : [],
  };
}
