import { runInNewContext } from "node:vm";
import { setFlagsFromString } from "node:v8";
import { randomBytes } from "node:crypto";
import { mainWatchdog } from "./main-watchdog.js";
import * as hooks from "./hibernation-hooks.js";
import { wakePageHtml } from "./wake-page.js";

// Окно засыпает через 8 минут после того, как его отпустили (слово владельца 16.11.2026: «только после 8 минут без
// действия»). Раньше было 30 с, а при запущенной игре — 3 с; быстрого сна при игре больше нет, срок один для всех.
export const HIBERNATE_IDLE_MS = 8 * 60 * 1000;

const SWITCH_ON = new Set(["on", "1", "true", "yes"]);
const SWITCH_OFF = new Set(["off", "0", "false", "no"]);
const RETRY_MS = 15000;
const REPLY_WAIT_MS = 4000;
const WAKE_WAIT_MS = 20000;
const TRIM_AT_MS = [5000, 65000];
const MEGABYTE = 1048576;
const WAKE_SCRIPT = 'document.documentElement.classList.add("waking")';

export function hibernationEnabled(options = {}) {
  const channel = options.channel === undefined ? null : options.channel;
  const env = options.env === undefined ? process.env : options.env;
  const word = String(env.ASTRAL_HIBERNATE ?? "").trim().toLowerCase();
  const verdict = [[SWITCH_ON, true], [SWITCH_OFF, false]].find(([words]) => words.has(word));
  return verdict ? verdict[1] : channel === "alpha";
}

// --- заглушка сна -------------------------------------------------------------

// Сама страница — экран пробуждения (`wake-page.js`, 15.11.2026): знак тлеет и разгорается, под ним «Просыпаемся…».
export function sleepPageUrl(language = "ru") {
  return `data:text/html;charset=utf-8,${encodeURIComponent(wakePageHtml(language))}`;
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function withWakeFlag(target) {
  target.searchParams.set("hibernation", "1");
  return target.toString();
}

export function wakeUrl(url) {
  const target = parseUrl(url);
  return target ? withWakeFlag(target) : url;
}

// --- вспомогательные функции --------------------------------------------------

function collectGarbage() {
  try {
    setFlagsFromString("--expose-gc");
    const collect = runInNewContext("gc");
    collect();
  } catch {
    // сборка кучи необязательна
  }
}

function withNames(label, names) {
  return names.length > 0 ? `; ${label}: ${names.join(", ")}` : "";
}

function toMegabytes(bytes) {
  return Math.round(bytes / MEGABYTE);
}

function toSeconds(ms) {
  return (ms / 1000).toFixed(1).replace(".", ",");
}

// Общий список таймеров: все создаются с unref и снимаются разом.
function createBoard(timers) {
  let handles = [];
  return {
    get empty() {
      return handles.length === 0;
    },
    schedule(ms, action) {
      const timer = timers.setTimeout(action, ms);
      timer?.unref?.();
      handles = handles.concat([timer]);
      return timer;
    },
    cancelAll() {
      const stale = handles;
      handles = [];
      stale.forEach((timer) => timers.clearTimeout(timer));
    },
  };
}

// Шаги конвейера идут по очереди; шаг, вернувший false, прерывает цепочку.
async function runSteps(context, steps) {
  for (const step of steps) {
    let outcome = step(context);
    if (outcome instanceof Promise) outcome = await outcome;
    if (outcome === false) return false;
  }
  return true;
}

// --- спячка -------------------------------------------------------------------

export function createHibernation({
  IPC,
  handleIpc,
  trusted,
  windowAttention,
  log = () => {},
  busy = () => null,
  language = () => "ru",
  channel = null,
  env = process.env,
  timers = globalThis,
  now = Date.now,
  gc = collectGarbage,
  idleMs = HIBERNATE_IDLE_MS,
  appWindow = null,
  trimMemory = null,
}) {
  const board = createBoard(timers);
  const waiters = new Map();
  const st = {
    phase: "awake",
    sleptAt: 0,
    why: "",
    held: "",
    trim: null,
    lastFocused: true,
    remembered: null,
    windowHold: "",
    snapshot: null,
    url: "",
    abandoned: false,
    falling: null,
    wakeStarted: 0,
    wakeHandle: undefined,
  };

  function enabled() {
    return hibernationEnabled({ channel, env });
  }

  function note(level, message) {
    log({ level, source: "hibernation", message });
  }

  function retryLater(reason) {
    return board.schedule(RETRY_MS, () => tryToSleep(reason));
  }

  // --- окно и фокус

  function currentWindow() {
    const stale = !st.remembered || st.remembered.isDestroyed?.();
    if (stale && appWindow) st.remembered = appWindow() || null;
    const win = st.remembered;
    return win && !win.isDestroyed?.() ? win : null;
  }

  function isFocused() {
    const win = currentWindow();
    return typeof win?.isFocused === "function" ? Boolean(win.isFocused()) : st.lastFocused;
  }

  // --- планы

  // Один срок на всё: от ухода фокуса до сна `idleMs`, запущена игра или нет.
  function plan() {
    board.cancelAll();
    board.schedule(idleMs, () => tryToSleep("окно отпущено"));
  }

  async function squeeze() {
    const reply = await trimMemory().catch(() => null);
    const list = reply?.processes;
    if (!Array.isArray(list) || list.length === 0) return;
    const sums = list.reduce(
      (acc, entry) => ({
        before: acc.before + (Number(entry.workingSetBefore) || 0),
        after: acc.after + (Number(entry.workingSetAfter) || 0),
        trimmed: acc.trimmed + (entry.trimmed ? 1 : 0),
      }),
      { before: 0, after: 0, trimmed: 0 },
    );
    st.trim = { ...sums, total: list.length };
    const range = [sums.before, sums.after].map(toMegabytes).join(" → ");
    note("info", `спячка: рабочий набор процессов ${range} МБ (${sums.trimmed} из ${list.length})`);
  }

  // --- сон: просьба о снимке и шаги конвейера

  function requestSnapshot(contents) {
    const token = randomBytes(12).toString("hex");
    return new Promise((resolve) => {
      const finish = (value, clear) => {
        waiters.delete(token);
        if (clear) timers.clearTimeout(timer);
        resolve(value);
      };
      const timer = timers.setTimeout(() => finish(null, false), REPLY_WAIT_MS);
      waiters.set(token, (reply) => finish(reply, true));
      try {
        contents.send(IPC.HIBERNATION_PREPARE, { token });
      } catch {
        finish(null, true);
      }
    });
  }

  // Шаг 1: спросить у окна снимок и занятость.
  async function askForSnapshot(ctx) {
    ctx.answer = await requestSnapshot(ctx.contents);
    return true;
  }

  // Шаг 2: фокус мог вернуться, пока ждали ответ.
  function checkFocusBack() {
    if (!st.abandoned && !isFocused()) return true;
    st.phase = "awake";
    if (!isFocused()) plan();
    return false;
  }

  // Шаг 3: окно не ответило или занято — спать пока нельзя.
  function checkWindowBusy(ctx) {
    const { answer } = ctx;
    const blame = [
      [!answer, () => "окно не ответило"],
      [answer?.busy, () => `окно: ${answer.busy}`],
    ].find(([applies]) => applies);
    if (!blame) return true;
    st.held = blame[1]();
    st.phase = "awake";
    retryLater(ctx.reason);
    return false;
  }

  // Шаг 4: вместо интерфейса грузится заглушка.
  async function loadSleepPage(ctx) {
    const { contents } = ctx;
    st.snapshot = ctx.answer.snapshot;
    st.url = ctx.address;
    const keepPage = (event) => event.preventDefault();
    try {
      contents.on("will-prevent-unload", keepPage);
      const sleepPage = sleepPageUrl(language());
      await contents.loadURL(sleepPage);
    } catch (error) {
      note("warn", `спячка: заглушка не загрузилась (${error?.message || error}) — окно остаётся как было`);
      st.snapshot = null;
      st.phase = "awake";
      return false;
    } finally {
      contents.removeListener("will-prevent-unload", keepPage);
    }
    return true;
  }

  // Шаг 5: хуки сна и сборка кучи.
  async function runHooksAndCollect(ctx) {
    ctx.failed = await hooks.runSleepHooks();
    gc();
    return true;
  }

  // Шаг 6: запись о сне, план очистки памяти.
  function markAsleep(ctx) {
    st.sleptAt = now();
    st.why = ctx.reason;
    st.phase = "asleep";
    if (trimMemory) {
      for (const at of TRIM_AT_MS) board.schedule(at, squeeze);
    }
    note("info", `спячка: уснули (${ctx.reason})${withNames("не остановились", ctx.failed)}`);
    return true;
  }

  const sleepSteps = [askForSnapshot, checkFocusBack, checkWindowBusy, loadSleepPage, runHooksAndCollect, markAsleep];

  async function descend(reason, win, address) {
    board.cancelAll();
    st.phase = "falling";
    st.abandoned = false;
    const context = { reason, address, contents: win.webContents, answer: null, failed: [] };
    if (!(await runSteps(context, sleepSteps))) return;
    if (st.abandoned || isFocused()) await wake("фокус вернулся, пока засыпали");
  }

  // Причины, по которым спать пока нельзя: каждая проба даёт список строк.
  function probeOwnBusy() {
    try {
      const own = busy();
      return own ? [String(own)] : [];
    } catch {
      return [];
    }
  }

  function probeWindowHold() {
    return st.windowHold ? [`окно: ${st.windowHold}`] : [];
  }

  function probeOwners() {
    return hooks.hibernationBusy().map((owner) => `${owner.name}: ${owner.reason}`);
  }

  function probeWatchdog() {
    const calls = mainWatchdog.channels().filter((name) => !name.includes("hibernation"));
    return calls.length > 0 ? [`вызовы окна: ${calls.join(", ")}`] : [];
  }

  const busyProbes = [probeOwnBusy, probeWindowHold, probeOwners, probeWatchdog];

  function pageIssue(contents, address) {
    if (/^https?:/i.test(address) && !contents.isLoading()) return null;
    if (contents.isLoading()) return "окно грузится";
    return `адрес ${address.slice(0, 40)}`;
  }

  async function tryToSleep(reason) {
    const win = currentWindow();
    const stop = [
      [() => !enabled(), () => "выключена"],
      [() => st.phase !== "awake", () => `фаза ${st.phase}`],
      [() => !win, () => "окна нет"],
      [() => isFocused(), () => "окно в фокусе"],
    ].find(([applies]) => applies());
    if (stop) {
      st.held = stop[1]();
      return;
    }
    const contents = win.webContents;
    const address = contents.getURL();
    const issue = pageIssue(contents, address);
    if (issue) {
      st.held = issue;
      retryLater(reason);
      return;
    }
    const reasons = busyProbes.flatMap((probe) => probe());
    if (reasons.length > 0) {
      st.held = reasons.join("; ");
      retryLater(reason);
      return;
    }

    st.held = "";
    const run = descend(reason, win, address);
    st.falling = run;
    try {
      await run;
    } finally {
      if (st.falling === run) st.falling = null;
    }
  }

  // --- пробуждение

  async function loadWithRetry(contents, target) {
    for (const last of [false, true]) {
      try {
        await contents.loadURL(target);
        return;
      } catch (error) {
        if (last) note("warn", `спячка: интерфейс не загрузился (${error?.message || error})`);
      }
    }
  }

  function beginWake() {
    board.cancelAll();
    st.phase = "waking";
    st.wakeStarted = now();
  }

  async function runWakeHooksStep(ctx) {
    ctx.failed = await hooks.runWakeHooks();
  }

  function pokeWakeScript(ctx) {
    ctx.contents = ctx.win.webContents;
    ctx.contents.executeJavaScript(WAKE_SCRIPT).catch(() => {});
  }

  function noteWaking(ctx) {
    const slept = Math.round((st.wakeStarted - st.sleptAt) / 1000);
    note("info", `спячка: просыпаемся (${ctx.reason}) после ${slept} с${withNames("не поднялись", ctx.failed)}`);
  }

  function armWakeTimeout() {
    st.wakeHandle = timers.setTimeout(() => finishWake("интерфейс не ответил"), WAKE_WAIT_MS);
    st.wakeHandle?.unref?.();
  }

  function reloadInterface(ctx) {
    return loadWithRetry(ctx.contents, wakeUrl(st.url));
  }

  const wakeSteps = [beginWake, runWakeHooksStep, pokeWakeScript, noteWaking, armWakeTimeout, reloadInterface];

  async function wake(reason) {
    if (st.phase !== "asleep") return;
    const win = currentWindow();
    if (!win) return;
    await runSteps({ reason, win, contents: null, failed: [] }, wakeSteps);
  }

  function finishWake(reason) {
    if (st.phase !== "waking") return;
    timers.clearTimeout(st.wakeHandle);
    st.phase = "awake";
    st.snapshot = null;
    note("info", `спячка: проснулись за ${toSeconds(now() - st.wakeStarted)} с (${reason})`);
    if (!isFocused()) plan();
  }

  // --- каналы окна

  function acceptReply(payload) {
    const token = String(payload?.token || "");
    const waiter = waiters.get(token);
    const known = waiter !== undefined;
    if (known) {
      waiters.delete(token);
      waiter({
        busy: payload.busy ? String(payload.busy).slice(0, 200) : null,
        snapshot: payload.snapshot ?? null,
      });
    }
    return known;
  }

  function rememberHold(payload) {
    st.windowHold = payload?.reason ? String(payload.reason).slice(0, 200) : "";
    return true;
  }

  function handOverSnapshot() {
    if (st.phase !== "waking") return null;
    const taken = st.snapshot ?? null;
    st.snapshot = null;
    return taken;
  }

  function confirmWoke() {
    finishWake("интерфейс готов");
    return true;
  }

  // --- подписки

  if (enabled() && currentWindow() && !isFocused()) plan();

  // Что делать с засыпанием или сном, когда окно вернуло фокус.
  const focusReactions = {
    falling: () => {
      st.abandoned = true;
    },
    asleep: () => {
      wake("окно в фокусе");
    },
  };

  function reactToFocus() {
    focusReactions[st.phase]?.();
  }

  windowAttention.subscribe((snapshot, window) => {
    st.lastFocused = Boolean(snapshot?.focused);
    if (window) st.remembered = window;
    if (!enabled()) return;
    if (st.lastFocused) {
      board.cancelAll();
      reactToFocus();
    } else if (st.phase === "awake" && board.empty) {
      plan();
    }
  });

  const channelReplies = [
    [IPC.HIBERNATION_READY, acceptReply],
    [IPC.HIBERNATION_HOLD, rememberHold],
    [IPC.HIBERNATION_TAKE, handOverSnapshot],
    [IPC.HIBERNATION_WOKE, confirmWoke],
  ];
  for (const [channelName, answer] of channelReplies) {
    handleIpc(channelName, (event, payload) => trusted(event, () => answer(payload)));
  }

  return {
    state() {
      const { phase, sleptAt, why, held, trim } = st;
      return { phase, enabled: enabled(), sleptAt, why, focused: isFocused(), held, trim };
    },
    sleepNow(reason = "по просьбе") {
      return tryToSleep(reason);
    },
    wakeNow(reason = "по просьбе") {
      return wake(reason);
    },
    settled() {
      return st.falling ?? Promise.resolve();
    },
  };
}

// --- сборка для приложения ----------------------------------------------------

export async function createDesktopHibernation({
  appLog,
  presence,
  workshopOperations,
  activeOperations,
  updates,
  cloudAuth = () => null,
  ...rest
}) {
  const { appWindow } = await import("./app-window.js");
  const { app } = await import("electron");

  async function trimMemory() {
    const engine = await import("./native-engine.js");
    return engine.trimProcessMemory(app.getAppMetrics().map((metric) => metric.pid));
  }

  function busyReason() {
    return (
      (workshopOperations.isBusy() ? `запись в игру: ${workshopOperations.describe?.()?.title || "операция"}` : null)
      || (activeOperations.size ? "установка из каталога" : null)
      || (updates.getState?.()?.phase === "applying" ? "обновление ставится" : null)
      || (cloudAuth()?.isLoginPending?.() ? "вход" : null)
      || null
    );
  }

  const settings = Object.assign({}, rest, {
    appWindow,
    trimMemory,
    log: (entry) => appLog.record(entry),
    language: () => presence.language?.() || "ru",
    busy: busyReason,
  });
  const hibernation = createHibernation(settings);
  globalThis.__astralHibernation = hibernation;
  return hibernation;
}
