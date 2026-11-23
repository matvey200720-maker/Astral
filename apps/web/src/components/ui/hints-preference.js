import { useSyncExternalStore } from "react";

// Ключи хранилища — внешний договор, менять нельзя.
const KEYS = Object.freeze({ off: "astral.hints.off.v1", shown: "astral.editor.guide.v1" });

// Любое обращение к хранилищу берёт его заново и глотает исключения.
function attempt(job) {
  try {
    return job(globalThis.localStorage);
  } catch {
    return undefined;
  }
}

// Запись и оповещение идут вместе: подписчиков зовём и тогда, когда запись не удалась.
function commit(job) {
  attempt(job);
  board.announce();
}

export function hintsEnabled() {
  return attempt((store) => store.getItem(KEYS.off)) !== "1";
}

export function disableHints() {
  commit((store) => store.setItem(KEYS.off, "1"));
}

export function enableHints({ fresh = true } = {}) {
  commit((store) => {
    store.removeItem(KEYS.off);
    if (fresh) store.removeItem(KEYS.shown);
  });
}

function createBoard() {
  const subscribers = new Set();
  return {
    join(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    announce() {
      Array.from(subscribers).forEach((callback) => callback());
    },
  };
}

const board = createBoard();

// Событие storage из другого окна; без addEventListener работают только оповещения модуля.
function watchOtherWindows(onChange) {
  const host = globalThis;
  if (typeof host.addEventListener !== "function") return null;

  const handler = (event) => {
    if (event.key == null || event.key === KEYS.off) onChange();
  };
  host.addEventListener("storage", handler);
  return () => host.removeEventListener("storage", handler);
}

function subscribeToHints(onChange) {
  const leave = board.join(onChange);
  const detach = watchOtherWindows(onChange);
  return () => {
    leave();
    detach?.();
  };
}

const hintsOnServer = () => true;

export const useHintsEnabled = () => useSyncExternalStore(subscribeToHints, hintsEnabled, hintsOnServer);
