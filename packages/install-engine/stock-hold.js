// Удержание «пока не трогать» после полного возврата игры: чтение и снятие.
import { readState, writeState, serializeMutation } from "./engine-state.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import { DEFAULT_DIR } from "./storage-state.js";

// Сбой чтения неотличим от «состояния нет».
async function loadState(stateDir) {
  try {
    return await readState(stateDir);
  } catch {
    return null;
  }
}

// Единая точка доступа к записи цели: обработчик ifHeld получает состояние и цель
// с удержанием, ifFree вызывается, когда удерживать нечего.
async function visitTarget(targetId, stateDir, ifHeld, ifFree) {
  const key = checkedRecordKey(targetId, "Target ID");
  const state = await loadState(stateDir);
  const target = state ? ownRecordValue(state.targets, key) : undefined;
  return target?.stockHold ? ifHeld(state, target) : ifFree();
}

export async function stockHoldOf({ targetId = "default", stateDir = DEFAULT_DIR } = {}) {
  return visitTarget(targetId, stateDir, (state, target) => target.stockHold, () => null);
}

// Не async: разбор аргумента падает синхронно, всё остальное идёт через общую очередь.
export function releaseStockHold({ targetId = "default", stateDir = DEFAULT_DIR } = {}) {
  const clearHold = async (state, target) => {
    delete target.stockHold;
    await writeState(state, stateDir);
    return true;
  };
  return serializeMutation(() => visitTarget(targetId, stateDir, clearHold, () => false));
}
