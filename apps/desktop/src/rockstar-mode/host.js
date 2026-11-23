/*
 * Хозяин режима Rockstar (05.11.2026): слушает процессы игры и говорит
 * сессиям (`@modovik/install-engine/rockstar-mode/session.js`), когда
 * подставлять моды и когда возвращать чистые файлы. Хозяином бывает фоновый
 * агент (`agent.js`) — он работает и при закрытом Astral, — или окно, если
 * агента нет (у ручного способа агента нет никогда, следит окно). Хозяин один
 * на ПК: два одновременно двигали бы файлы.
 *
 * Что он делает сверх «игра появилась — подставить, пропала — вернуть»:
 *
 *   — повторяет подстановку, пока игра открыта, если файл был занят, докачивал
 *     лаунчер Rockstar или писало окно: сначала часто (занятость обычно
 *     секундная — игра ещё не открыла архив), потом раз в 10 с;
 *   — выдерживает паузу перед возвратом (игра перезапускается за доли секунды:
 *     BattlEye, заглушка лаунчера) и сверяет снимком процессов, что игры
 *     правда нет; вернулась в паузе — возврат отменяется. Пауза у каждой игры
 *     своя (`plan.js`, `returnPauseMs`): у копии из Rockstar Games Launcher не
 *     больше 250 мс — лаунчер сверяет файлы через 1–2 с после выхода, у
 *     остальных 3 с;
 *   — возврат занятого файла и возврат под докачку повторяет раз в секунду;
 *   — раз в 5 с во время сессии сверяет штампы архивов — заметил перекачку
 *     лаунчером, ставит метку и говорит окну;
 *   — раз в 10 с делает восстановление (после сбоя) и подаёт сердцебиение;
 *   — не считает игрой заглушку BattlEye и запускающие процессы (лаунчеры
 *     RAGE MP, alt:V и т. п.), что висят без игры дольше десяти минут;
 *   — запускающие процессы (`process-watch.js`, `EARLY_TRIGGER_NAMES`) — старт
 *     игры только у копий не из Rockstar Games Launcher (`needed: false`): у
 *     копии из RGL сверка лаунчера идёт после них, и моды в игре на этом шаге
 *     вернули бы перекачку;
 *   — способы с ручным запуском: подставляет только после «Захожу в игру»
 *     (ждёт старт до 30 минут); ожидание гаснет, как только игра появилась и моды
 *     подставлены (или «Вышел из игры», или срок вышел), и возвращает сам после
 *     выхода — новое ожидание начинается только новым «Захожу в игру»
 *     (`status().manualWaiting` — «ждём старт игры, моды ещё не в игре»);
 *   — прежний способ «как ReplaceX» перед возвратом закрывает процессы Rockstar.
 */

import path from "node:path";
import { methodPlan, returnPauseMs } from "@modovik/install-engine/rockstar-mode/plan.js";
import { isEarlyTrigger, isLauncherStub } from "./process-watch.js";

const realTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
export const MANUAL_WAIT_MS = 30 * 60_000;

const rootKey = (gameRoot) => path.resolve(String(gameRoot || "")).toLowerCase();
const gameRunningError = (message) => Object.assign(new Error(`ROCKSTAR_MODE_GAME_RUNNING: ${message}`), { code: "ROCKSTAR_MODE_GAME_RUNNING" });

/**
 * @param {object} options
 * @param {() => Promise<{gameRoot: string, method: string, needed?: boolean}[]>} options.roots  игры, у которых режим включён (`needed` — копия из Rockstar Games Launcher)
 * @param {(gameRoot: string, method: string) => ReturnType<typeof import("@modovik/install-engine/rockstar-mode/session.js").createModeSession>} options.sessionFor
 * @param {() => Promise<boolean>} options.gameAlive  снимок: игра (не заглушка) запущена
 */
export function createModeHost({
  roots,
  sessionFor,
  gameAlive,
  log = async () => {},
  emit = () => {},
  heartbeat = async () => {},
  killBlockers = async () => 0,
  now = () => Date.now(),
  timers = realTimers,
  retryArmMs = 10_000,
  /* Первые повторы подстановки — часто: файл занят на секунду, а игра откроет архив сразу после старта. */
  quickRetryMs = 250,
  quickRetries = 12,
  recoverMs = 10_000,
  repairWatchMs = 5_000,
  stubMaxMs = 10 * 60_000,
  returnRetryMs = 1000,
  returnRetries = 120,
} = {}) {
  const running = new Map();
  const armed = new Set();
  /* Возврат у каждой игры свой: пауза зависит от копии (`returnPauseMs`). */
  const returnTimers = new Map();
  let writers = 0;
  let retryTimer = null;
  let retryCount = 0;
  let intervals = [];
  let manualUntil = 0;
  let stopped = true;
  let chain = Promise.resolve();

  /* Дела хозяина идут по очереди: событие дозора, повтор и сердцебиение не пересекаются. */
  const serial = (task) => {
    const next = chain.then(task, task);
    chain = next.catch(() => {});
    return next;
  };

  /** Настоящая игра запущена (не заглушка и не запускающий процесс). */
  const realGame = () => [...running.values()].some((item) => !isLauncherStub(item.name));

  /**
   * Сколько процессов считается игрой у копии. Запускающие процессы не считаются
   * у копии из Rockstar Games Launcher (`needed`). Заглушка без игры дольше
   * `stubMaxMs` — нет.
   */
  function counting(needed = false) {
    const all = [...running.values()].filter((item) => !(needed && isEarlyTrigger(item.name)));
    if (all.some((item) => !isLauncherStub(item.name))) return all.length;
    return all.filter((item) => now() - item.since < stubMaxMs).length;
  }

  const sessions = async () =>
    (await roots()).map((item) => ({
      ...item,
      needed: Boolean(item.needed),
      plan: methodPlan(item.method),
      pauseMs: returnPauseMs(item.method, { needed: Boolean(item.needed) }),
      session: sessionFor(item.gameRoot, item.method),
    }));

  const anyCounting = (list) => list.some((item) => counting(item.needed) > 0);

  function remember(gameRoot, kind, extra = {}) {
    emit({ gameRoot: path.resolve(gameRoot), kind, at: new Date(now()).toISOString(), ...extra });
  }

  /* ------------------------------ подстановка ----------------------------- */

  function scheduleArmRetry({ quick = false } = {}) {
    if (retryTimer || stopped) return;
    /* Занятый файл — сначала часто; докачка лаунчера и прочее — раз в `retryArmMs`. */
    const wait = quick && retryCount < quickRetries ? quickRetryMs : retryArmMs;
    if (quick) retryCount += 1;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      return serial(armAll);
    }, wait);
  }

  async function armAll() {
    if (writers) return;
    let retry = false;
    let quick = false;
    /* Ожидание «Захожу в игру» гаснет, когда игра появилась и подстановка у ручных игр прошла: дальше состояние — «идёт игра». */
    let manualTouched = false;
    let manualPending = false;
    for (const { gameRoot, needed, plan, session } of await sessions()) {
      if (!counting(needed)) continue;
      const manual = plan.trigger === "manual";
      if (manual && now() > manualUntil) continue;
      if (manual) manualTouched = true;
      const pid = running.keys().next().value ?? null;
      const result = await session.arm({ pid }).catch((error) => ({ ok: false, reason: "error", results: [], error }));
      const kinds = result.results.map((item) => item.kind);
      if (kinds.some((kind) => kind === "live" || kind === "already")) {
        armed.add(rootKey(gameRoot));
        remember(gameRoot, "live");
      }
      if (kinds.includes("stale") || kinds.includes("torn")) remember(gameRoot, "stale");
      if (!result.ok) {
        if (manual) manualPending = true;
        if (result.reason === "repair-in-progress") remember(gameRoot, "repair-in-progress");
        else if (kinds.includes("busy")) {
          if (!retryCount) remember(gameRoot, "missed");
          quick = true;
        } else if (result.reason === "error") remember(gameRoot, "error", { message: String(result.error?.message || result.error) });
        else if (kinds.includes("error")) remember(gameRoot, "error", { message: result.results.find((item) => item.kind === "error")?.message });
        retry = true;
      }
    }
    /* Моды ещё не встали (файл занят, докачка лаунчера) — ожидание остаётся: повторы подставят их, пока игра открыта. */
    if (manualTouched && !manualPending) manualUntil = 0;
    if (retry) scheduleArmRetry({ quick });
    else retryCount = 0;
  }

  /* -------------------------------- возврат ------------------------------- */

  const dropReturn = (key) => {
    const entry = returnTimers.get(key);
    if (entry) timers.clearTimeout(entry.timer);
    returnTimers.delete(key);
  };

  /** `needed` — копия из Rockstar Games Launcher: запускающий процесс её возврат не отменяет (для неё он не игра). */
  function planReturn(key, delayMs, task, needed = false) {
    dropReturn(key);
    returnTimers.set(key, { needed, timer: timers.setTimeout(() => serial(task), delayMs) });
  }

  /** Вернуть чистые файлы одной игры; `attempt` — какой по счёту повтор. */
  async function returnRoot(key, attempt) {
    returnTimers.delete(key);
    if (writers || stopped) return;
    const item = (await sessions()).find((candidate) => rootKey(candidate.gameRoot) === key);
    if (!item || counting(item.needed) > 0) return;
    /* События дозора могли потеряться (хост перезапускался): игра, которой ещё нет в списке, — не повод возвращать. */
    if (await gameAlive().catch(() => false)) {
      /* Событие старта пропало (дозор перезапускался): игра идёт, но хозяин о ней не знает, и события выхода тоже не будет —
         поэтому не бросаем, а спрашиваем снова, пока игра не закроется. */
      if (attempt === 0) await log("watch", "return-cancelled", { reason: "snapshot" });
      planReturn(key, returnRetryMs * 3, () => returnRoot(key, attempt === 0 ? 1 : attempt), item.needed);
      return;
    }
    const { gameRoot, plan, session } = item;
    if (plan.killBlockers) {
      const killed = await killBlockers(gameRoot).catch(() => 0);
      await log("watch", "blockers-killed", { count: killed });
    }
    const result = await session.disarm().catch((error) => ({ ok: false, results: [], error }));
    const kinds = result.results.map((entry) => entry.kind);
    if (result.ok) {
      armed.delete(key);
      if (kinds.includes("returned")) remember(gameRoot, "parked");
      if (kinds.includes("foreign")) remember(gameRoot, "lost");
      return;
    }
    if (result.reason === "repair-in-progress") remember(gameRoot, "repair-in-progress");
    else if (result.error) remember(gameRoot, "error", { message: String(result.error.message || result.error) });
    if (attempt < returnRetries && !stopped) planReturn(key, returnRetryMs, () => returnRoot(key, attempt + 1), item.needed);
  }

  /** Игры, у которых игры больше нет, — вернуть после своей паузы. */
  async function startReturn() {
    for (const item of await sessions()) {
      const key = rootKey(item.gameRoot);
      if (counting(item.needed) > 0) continue;
      planReturn(key, item.pauseMs, () => returnRoot(key, 0), item.needed);
    }
  }

  /* ------------------------------ события дозора -------------------------- */

  /** Появился процесс игры (`{ name, pid }`). */
  function onGameStart(info) {
    if (running.has(info.pid)) return Promise.resolve();
    running.set(info.pid, { name: info.name, since: now() });
    retryCount = 0;
    const cancelled = [...returnTimers].filter(([, entry]) => !(entry.needed && isEarlyTrigger(info.name))).map(([key]) => key);
    if (cancelled.length) {
      for (const key of cancelled) dropReturn(key);
      void log("watch", "return-cancelled", { reason: "game-back", pid: info.pid });
    }
    void log("watch", "game-seen", { name: info.name, pid: info.pid });
    return serial(armAll);
  }

  /** Процесс игры закрылся (`{ pid }`). */
  function onGameExit(info) {
    if (!running.delete(info.pid)) return Promise.resolve();
    void log("watch", "game-gone", { name: info.name, pid: info.pid });
    return writers ? Promise.resolve() : serial(startReturn);
  }

  /* --------------------------- восстановление, сердцебиение --------------- */

  async function recoverAll() {
    const alive = await gameAlive().catch(() => false);
    for (const { gameRoot, needed, session } of await sessions()) {
      /* Эту игру хозяин ещё держит (идёт игра или запускающий процесс) — сессия принимается как есть. */
      if (counting(needed) > 0) continue;
      const result = await session.recover({ gameAlive: alive }).catch((error) => ({ action: "error", error }));
      if (result.action === "returned") remember(gameRoot, "recovered");
      else if (result.action === "adopted") armed.add(rootKey(gameRoot));
      else if (result.action === "error") remember(gameRoot, "error", { message: String(result.error?.message || result.error) });
    }
  }

  /** Просроченные заглушки (и запускающие процессы) без игры уходят из списка; сколько ушло. */
  function pruneStubs() {
    if (realGame()) return 0;
    let dropped = 0;
    for (const [pid, item] of [...running]) {
      if (now() - item.since < stubMaxMs) continue;
      running.delete(pid);
      dropped += 1;
    }
    return dropped;
  }

  async function tick() {
    if (writers || stopped) return;
    if (running.size && !returnTimers.size && pruneStubs()) {
      await log("watch", "stub-expired", { minutes: Math.round(stubMaxMs / 60_000) });
      await startReturn();
    }
    if (!returnTimers.size) await recoverAll();
    await heartbeat({ status: anyCounting(await sessions()) ? "armed" : "watching", armed: armed.size });
  }

  async function repairTick() {
    if (writers || stopped || !armed.size) return;
    for (const { gameRoot, session } of await sessions()) {
      if (!armed.has(rootKey(gameRoot))) continue;
      const found = await session.detectRepair().catch(() => null);
      if (found?.fresh) remember(gameRoot, "repaired", { rel: found.rel });
    }
  }

  /* ----------------------------- ручной запуск ---------------------------- */

  /** «Захожу в игру»: ждём старт до 30 минут и подставляем моды в момент появления процесса. */
  async function armNow() {
    if (realGame() || (await gameAlive().catch(() => false))) throw gameRunningError("GTA V уже запущена.");
    await serial(recoverAll);
    manualUntil = now() + MANUAL_WAIT_MS;
    await log("manual", "waiting", { minutes: MANUAL_WAIT_MS / 60_000 });
    /* Запускающий процесс уже идёт (лаунчер сервера открыт) — подставляем сразу. */
    await serial(armAll);
    return { waitingUntil: new Date(manualUntil).toISOString() };
  }

  /** «Вышел из игры»: вернуть чистые файлы немедленно (или отменить ожидание, если игра не стартовала). */
  async function disarmNow() {
    manualUntil = 0;
    if (realGame() || (await gameAlive().catch(() => false))) throw gameRunningError("GTA V ещё запущена.");
    await log("manual", "return-requested");
    for (const key of [...returnTimers.keys()]) dropReturn(key);
    for (const item of await sessions()) await serial(() => returnRoot(rootKey(item.gameRoot), returnRetries));
  }

  /* ------------------------------- жизнь ---------------------------------- */

  /** Окно собирается писать в игру — хозяин ничего не двигает, пока не вызвана возвращённая функция. */
  function holdWrites() {
    writers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      writers -= 1;
    };
  }

  async function start() {
    if (!stopped) return;
    stopped = false;
    await serial(recoverAll);
    intervals = [timers.setInterval(() => void serial(tick), recoverMs), timers.setInterval(() => void serial(repairTick), repairWatchMs)];
    await heartbeat({ status: "watching", armed: armed.size });
  }

  function stop() {
    stopped = true;
    for (const timer of intervals) timers.clearInterval(timer);
    intervals = [];
    for (const key of [...returnTimers.keys()]) dropReturn(key);
    if (retryTimer) timers.clearTimeout(retryTimer);
    retryTimer = null;
  }

  return {
    start,
    stop,
    onGameStart,
    onGameExit,
    armNow,
    disarmNow,
    holdWrites,
    tick: () => serial(tick),
    repairTick: () => serial(repairTick),
    idle: () => chain,
    status: () => ({ running: [...running.entries()].map(([pid, item]) => ({ pid, name: item.name })), armed: [...armed], manualWaiting: now() < manualUntil, stopped }),
  };
}
