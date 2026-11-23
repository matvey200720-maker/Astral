// Общий снимок службы обновлений для всех экранов: одна подписка на мост window.modovik.updates,
// пока подписан хотя бы один компонент (docs/beta/release-channels.md, §5.3-5.4).
import { forgetHiddenTransfers } from "./memory.js";
import { OFF_STATE, normalizeState } from "./model.js";
import { desktopHost } from "../../api.js";
import { useSyncExternalStore } from "react";

// Мост есть, а снимка нет (главный процесс собран без службы): через 3 с считаем «службы нет»
const SNAPSHOT_WAIT_MS = 3000;
const BUSY_RETRY_MS = 5000;

const freshSnap = () => Object.freeze({ state: OFF_STATE, ...{ loaded: false, notice: null } });
let snap = freshSnap();
const listeners = new Set();
// era растёт при каждом подключении и отключении: поздние ответы прежних подключений не проходят;
// loop - общий цикл «перезапустить, как только можно», refused - номера, которые сами больше не пробуем
let [unlink, timer, loop, era] = [null, null, null, 0];
const refused = new Set();

// Новый замороженный снимок и оповещение всех (quiet: без оповещения - React сверит снимок сам)
function put(patch, quiet) {
  snap = Object.freeze(Object.assign({}, snap, patch));
  if (!quiet) [...listeners].forEach((fn) => fn());
}

// Пустой объект вместо null: «моста нет» и «метода нет» проверяются одинаково
function bridge() {
  return desktopHost()?.updates ?? {};
}

// Окно из-за обновлений падать не должно: сбой моста, нет метода и ответ undefined дают null
const callBridge = (method, ...args) =>
  new Promise((resolve) => resolve(bridge()[method]?.(...args))).then(
    (reply) => reply ?? null,
    () => null,
  );

const land = (raw) => put({ loaded: true, state: normalizeState(raw) });

// Ответ с ключом phase (даже со значением undefined) становится состоянием
const accept = (reply) => {
  if (reply !== null && typeof reply === "object" && "phase" in reply) land(reply);
  return reply;
};

const setNotice = (kind) => put({ notice: kind && { kind, at: +new Date() } });

// setAuto и dismissFailure сначала меняют экран: переключатель не ждёт ответа службы
const amend = (fields) => put({ state: normalizeState(Object.assign({}, snap.state, fields)) });

function connect() {
  const turn = ++era;
  const link = bridge();
  const live = typeof link.subscribe === "function";
  if (live) {
    // каждое подключение даёт мосту свою функцию: повторная подписка той же функции плодит подписки моста
    unlink = link.subscribe((raw) => land(raw));
  } else if (typeof link.state === "function") {
    // ответ после ухода подписчика (или после новой подписки) не нужен
    link.state().then(
      (raw) => (turn === era ? land(raw) : null),
      () => turn === era && put({ loaded: true }),
    );
  } else {
    put({ loaded: true }, true);
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    if (!snap.loaded) put({ loaded: true });
  }, SNAPSHOT_WAIT_MS);
}

// Отключение от моста; отписка может бросить - тогда на этом всё и обрывается
function stop() {
  era += 1;
  clearTimeout(timer);
  timer = null;
  if (unlink) {
    unlink();
    unlink = null;
  }
}

export function subscribeUpdates(listener) {
  if (listeners.add(listener).size === 1) connect();
  return () => listeners.delete(listener) && !listeners.size && stop();
}

export function getUpdatesSnapshot() {
  return snap;
}

export const useUpdates = () => useSyncExternalStore(subscribeUpdates, getUpdatesSnapshot, getUpdatesSnapshot);

// apply зовёт мост напрямую: его ответ не принимается как состояние и undefined остаётся undefined
function apply() {
  setNotice(null);
  const link = bridge();
  if (typeof link.apply !== "function") return Promise.resolve(null);
  return new Promise((resolve) => resolve(link.apply())).then(
    (reply) => {
      if (reply?.started !== false) return reply;
      setNotice(reply.reason === "busy" ? "busy" : "failed");
      return reply;
    },
    () => {
      setNotice("helper");
      return null;
    },
  );
}

// Экран-замок: «занято» (идёт установка в игру) - ждём и спрашиваем снова, пока состояние «готово».
// Хелпер не запустился - этого кандидата сам больше не пробуем, иначе замок гонял бы запуск по кругу.
function applyWhenFree(sequence, options = {}) {
  const wait = options.retryMs === undefined ? BUSY_RETRY_MS : options.retryMs;
  if (loop || refused.has(sequence)) return loop ?? Promise.resolve(null);
  const attempt = () =>
    apply().then((reply) => {
      const declined = reply?.started === false;
      if (declined && reply.reason === "busy") {
        const nap = new Promise((resolve) => setTimeout(resolve, wait));
        return nap.then(() => (snap.state.phase !== "ready" || !listeners.size ? reply : attempt()));
      }
      if (!reply || declined) refused.add(sequence);
      return reply;
    });
  const mine = attempt().finally(() => {
    if (loop === mine) loop = null;
  });
  loop = mine;
  return mine;
}

export function resetUpdatesStore() {
  stop();
  refused.clear();
  listeners.clear();
  loop = null;
  snap = freshSnap();
  forgetHiddenTransfers();
}

export const updateActions = {
  apply,
  applyWhenFree,
  cancel: () => callBridge("cancel").then(accept),
  check() {
    setNotice(null);
    return callBridge("check").then(accept);
  },
  clearNotice() {
    if (snap.notice) setNotice(null);
  },
  dismissFailure() {
    amend({ lastFailure: null });
    return callBridge("dismissFailure").then(accept);
  },
  download() {
    setNotice(null);
    return callBridge("download").then(accept);
  },
  installed: () => callBridge("installed"),
  ready: () => callBridge("ready"),
  retry() {
    return updateActions
      .check()
      .then((reply) => (normalizeState(reply).phase === "available" ? updateActions.download() : reply));
  },
  retryApply(sequence, options) {
    refused.delete(sequence);
    return applyWhenFree(sequence, options);
  },
  setAuto(value) {
    const enabled = Boolean(value);
    amend({ auto: enabled });
    return callBridge("setAuto", enabled).then(accept);
  },
};
