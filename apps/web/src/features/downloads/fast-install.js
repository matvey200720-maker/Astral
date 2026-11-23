/*
 * «Быстрая установка» в окне (13.11.2026, решение владельца): включена ли она и надо ли показать плашку первой установки.
 *
 * Правда живёт в главном процессе (настройки хранилища): он снимает и ставит тормоз записи на диск и помнит, отвечал ли
 * человек на плашку. Окно узнаёт о режиме при первом обращении (`getStorageStatus`) и из событий моста
 * (`onFastInstallEvent`): `{ kind: "changed", enabled }` — режим сменили, `{ kind: "offer" }` — началась первая установка.
 * Кнопка в «Загрузках» и плашка читают одно это состояние.
 */
import { useSyncExternalStore } from "react";
import { desktopHost } from "../../api.js";

const noop = () => {};
const watchers = new Set();
let snapshot = Object.freeze({ enabled: false, offer: false });
let connected = false;

function change(patch) {
  const next = { ...snapshot, ...patch };
  if (next.enabled === snapshot.enabled && next.offer === snapshot.offer) return;
  snapshot = Object.freeze(next);
  for (const listener of [...watchers]) listener();
}

function onEvent(event) {
  if (event?.kind === "offer") change({ offer: !snapshot.enabled });
  if (event?.kind === "changed") change({ enabled: event.enabled === true, ...(event.enabled === true ? { offer: false } : {}) });
}

const fromStatus = (status) => {
  if (status && typeof status.fastInstall === "boolean") change({ enabled: status.fastInstall });
};

function connect() {
  if (connected) return;
  connected = true;
  const host = desktopHost();
  try {
    host?.onFastInstallEvent?.(onEvent);
    Promise.resolve(host?.getStorageStatus?.()).then(fromStatus, noop);
  } catch {
    // Моста нет (сайт, старое приложение): кнопка остаётся выключенной.
  }
}

function watch(listener) {
  connect();
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
}

const read = () => snapshot;

/** Состояние «Быстрой установки»: `{ enabled, offer }`. */
export function useFastInstall() {
  return useSyncExternalStore(watch, read, read);
}

/** Включить или выключить. Окно меняется сразу; отказ главного процесса возвращает прежнее. */
export async function setFastInstall(enabled) {
  const before = snapshot.enabled;
  const next = enabled === true;
  change({ enabled: next, ...(next ? { offer: false } : {}) });
  try {
    fromStatus(await desktopHost()?.setFastInstall?.(next));
  } catch {
    change({ enabled: before });
  }
}

/** Ответ на плашку первой установки: «Применить» (`true`) или «Продолжить без ускорения», крестик, Esc (`false`). */
export async function answerFastInstallOffer(fast) {
  const before = snapshot.enabled;
  change({ offer: false, ...(fast === true ? { enabled: true } : {}) });
  try {
    fromStatus(await desktopHost()?.settleFastInstallOffer?.(fast === true));
  } catch {
    change({ enabled: before });
  }
}

/** Для тестов: забыть состояние и подписку на мост. */
export function resetFastInstallForTests() {
  connected = false;
  snapshot = Object.freeze({ enabled: false, offer: false });
  watchers.clear();
}
