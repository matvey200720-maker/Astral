// Общий снимок веток Astral для всех экранов: одна подписка на мост window.modovik.channels,
// пока подписан хоть один компонент (docs/beta/channels-launcher.md, §5).
import { desktopHost as hostBridge } from "../../api.js";
import { useSyncExternalStore as useStore } from "react";

// ---- приведение чужого снимка к безопасному виду: пределы длин и чисел защищают разметку
const isObj = (v) => typeof v === "object" && v !== null;
const isBranch = (v) => v === "release" || v === "beta" || v === "alpha";
const isNonNegative = (v) => typeof v === "number" && v >= 0 && v < Infinity;
function text(v, max = 80) {
  return typeof v === "string" && v.length && v.length <= max ? v : null;
}
const count = (v, cap = Infinity) => Math.min(isNonNegative(v) ? v : 0, cap);
const percent = (v) => (Number.isFinite(v) ? Math.round(Math.min(Math.max(v, 0), 100)) : null);
const textOf = (max) => (v) => text(v, max);
const countOf = (cap) => (v) => count(v, cap);
const attempts = (v) => count(v, 99) || 1;

// Обходчик схемы: поле -> читалка (значение, весь вход); порядок ключей схемы - порядок результата
const readBy = (schema, src) =>
  Object.fromEntries(Object.entries(schema).map(([key, read]) => [key, read(src[key], src)]));

// Читалка записи: нужен объект, пригодный по условию, иначе null; списки записей - через map/filter
const recordOf = (valid, schema) => (raw) => (isObj(raw) && valid(raw) ? readBy(schema, raw) : null);
const anyObject = () => true;
const withBranch = (raw) => isBranch(raw.channel);
const listOf = (read) => (v) => (Array.isArray(v) ? v.map((item) => read(item)).filter(Boolean) : []);

const RETRY = {
  attempt: attempts,
  max: attempts,
  inMs: countOf(3_600_000),
  code: (v) => text(v, 40) ?? "DEFAULT",
};

const TRANSFER = {
  stage: (v) => (v === "verify" ? "verify" : "download"),
  doneBytes: countOf(),
  totalBytes: countOf(),
  bytesPerSec: countOf(),
  etaSec: (v) => (isNonNegative(v) ? v : null),
  attempt: attempts,
  retry: recordOf(anyObject, RETRY),
  stalledMs: countOf(86_400_000),
  resumedFrom: countOf(),
  verifyPercent: percent,
  version: textOf(64),
};

const BUSY = {
  kind: (v) => (v === "install" ? "install" : "update"),
  phase: (v) => text(v, 32) ?? "checking",
  percent,
  error: textOf(40),
  transfer: recordOf(anyObject, TRANSFER),
};

const BRANCH = {
  channel: (v) => v,
  name: (v, b) => text(v) ?? `Astral ${b.channel}`,
  installed: recordOf(anyObject, {
    version: textOf(64),
    // сборка приводится к строке до проверки длины: число 130 даёт «130»
    build: (v) => text(String(v ?? ""), 32),
  }),
  current: (v) => v === true,
  available: (v) => {
    const version = text(v?.version, 64);
    return version && { version };
  },
  access: (v) => (v === "ok" || v === "denied" ? v : "unknown"),
  busy: recordOf(anyObject, BUSY),
};

const ALTERNATIVE = {
  channel: (v) => v,
  name: (v, a) => text(v) ?? `Astral ${a.channel}`,
  version: textOf(64),
  installed: (v) => v === true,
};

const DENIED = {
  channel: (v) => v,
  name: (v, d) => text(v) ?? `Astral ${d.channel}`,
  alternatives: listOf(recordOf(withBranch, ALTERNATIVE)),
};

const SWITCH_REQUEST = {
  id: (v) => v,
  from: (v) => (isBranch(v) ? v : null),
  to: (v) => v,
  fromName: (v) => text(v) ?? "Astral",
  toName: (v, r) => text(v) ?? `Astral ${r.to}`,
};

const SNAPSHOT = {
  enabled: () => true,
  ownChannel: (v) => (isBranch(v) ? v : null),
  ownName: (v) => text(v),
  branches: listOf(recordOf(withBranch, BRANCH)),
  knownAt: textOf(40),
  denied: recordOf(withBranch, DENIED),
  switchRequest: recordOf((raw) => text(raw.id) && isBranch(raw.to), SWITCH_REQUEST),
  // резерв под режим «только чтение» (channels-launcher.md, §6): пока объект проходит как есть
  dataMode: (v) => (isObj(v) ? v : null),
};

// Выключенное состояние - тот же снимок из пустого входа, только с enabled: false и замороженным списком
export const OFF_CHANNELS = Object.freeze({ ...readBy(SNAPSHOT, {}), enabled: false, branches: Object.freeze(Array()) });

export const normalizeChannels = (raw) => (isObj(raw) && raw.enabled === true ? readBy(SNAPSHOT, raw) : OFF_CHANNELS);

// ---- хранилище. dismissed живёт только до конца запуска: новый запуск покажет актуальное
const freshSnap = () => Object.freeze({ state: OFF_CHANNELS, ...{ loaded: false, dismissed: Object.freeze(Array()) } });
let snap = freshSnap();
const listeners = new Set();
// era растёт при каждом подключении и отключении: поздние ответы прежних подключений не проходят
let [unlink, era] = [null, 0];

// Новый замороженный снимок и оповещение всех (quiet: без оповещения - React сверит снимок сам)
function put(patch, quiet) {
  snap = Object.freeze(Object.assign({}, snap, patch));
  if (!quiet) [...listeners].forEach((fn) => fn());
}

// Пустой объект вместо null: «моста нет» и «метода нет» проверяются одинаково
function bridge() {
  return hostBridge()?.channels ?? {};
}

// Вызов моста: нет моста/метода, сбой и ответ undefined дают null
const callBridge = (method, ...args) =>
  new Promise((resolve) => resolve(bridge()[method]?.(...args))).then(
    (reply) => reply ?? null,
    () => null,
  );

const land = (raw) => put({ loaded: true, state: normalizeChannels(raw) });

// Ответ со снимком (ключ enabled есть, пусть и false) становится состоянием
const takeReply = (reply) => {
  if (isObj(reply) && "enabled" in reply) land(reply);
  return reply;
};

function connect() {
  const turn = ++era;
  const link = bridge();
  if (typeof link.subscribe === "function") {
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
  }
}

// Отключение от моста; отписка может бросить - тогда на этом всё и обрывается
function stop() {
  era += 1;
  if (unlink) {
    unlink();
    unlink = null;
  }
}

export function subscribeChannels(listener) {
  const first = listeners.add(listener).size < 2;
  if (first) connect();
  return () => listeners.delete(listener) && !listeners.size && stop();
}

export function getChannelsSnapshot() {
  return snap;
}

export const useChannels = () => useStore(subscribeChannels, getChannelsSnapshot, getChannelsSnapshot);

export function resetChannelsStore() {
  stop();
  listeners.clear();
  snap = freshSnap();
}

const unavailable = () => ({ started: false, reason: "unavailable" });

export const channelActions = {
  answer: (questionId, accepted) => callBridge("answer", questionId, Boolean(accepted)).then(takeReply),
  dismissDenied(channel) {
    if (snap.dismissed.includes(channel)) return;
    put({ dismissed: Object.freeze([...snap.dismissed, channel]) });
  },
  install: (channel) => callBridge("install", channel).then((reply) => reply ?? unavailable()),
  open(channel, options = {}) {
    const sure = options.confirm === undefined ? true : options.confirm;
    return callBridge("open", channel, { confirm: sure }).then((reply) => reply ?? unavailable());
  },
  refresh: () => callBridge("refresh").then(takeReply),
};
