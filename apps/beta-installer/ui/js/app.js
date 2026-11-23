// Состояние окна установщика: журнал последних событий хоста и короткие
// переходы между экранами. Рисует view.js, этот модуль ничего не рисует.
import { fullCode, isCodeComplete } from "./code.js";
import { presentError } from "./errors.js";
import { branchList } from "./branches.js";
import { formatUserCode, isBranch } from "./format.js";
import { createTranslator, isLanguage, pickLanguage } from "./i18n/index.js";
import { createStore } from "./store.js";

const LANG_KEY = "astral-installer-language";
const MODES = ["install", "update", "uninstall", "side"];
// Запасной срок кода, когда хост не прислал ни секунд, ни метки (BRIDGE.md, submitCode).
const CODE_TTL_MS = 600000;
// Порядок подписок на события хоста — часть контракта (см. описание, раздел 2).
const EVENT_NAMES = [
  "activation.confirmed", "activation.expired", "connection", "download.progress", "install.progress",
  "done", "error", "window.closeRequested", "update.progress", "update.rolledback", "update.done",
  "side.progress", "side.done", "uninstall.progress", "uninstall.done", "download.queue",
];
// Диалог крестика зависит от режима окна, а не от данных события.
const CLOSE_DIALOG = new Map([["install", "closing"], ["update", "busy-update"], ["side", "busy-side"]]);
// Порядок ключей у `actions` виден снаружи.
const ACTION_ORDER = [
  "boot", "setLanguage", "toggleLang", "closeLang", "editCode", "clearFieldError", "submitCode",
  "openVerifyUrl", "openSite", "openLogs", "cancelConfirm", "setOption", "chooseBranch",
  "continueFromBranch", "backToBranch", "chooseInstallDir", "startInstall", "requestCancel",
  "dismissDialog", "confirmCancel", "confirmClose", "retry", "restart", "pickFolder", "fitWindow",
  "reinstall", "launch", "quit", "enterCode", "setDeleteUserData", "uninstall", "windowDrag",
  "windowMinimize", "windowClose", "recheck",
];
// Действия-переходы: один готовый патч состояния, возвращают живое состояние.
const PATCH_ACTIONS = {
  closeLang: { langOpen: false },
  clearFieldError: { fieldError: null },
  continueFromBranch: { screen: "ready" },
  backToBranch: { screen: "branch" },
  requestCancel: { dialog: "cancel" },
  dismissDialog: { dialog: null },
  pickFolder: { screen: "ready", error: null, dialog: null, folderError: null },
  reinstall: { screen: "welcome", fieldError: null, notice: null },
};
// Вызовы наружу без аргументов: отказ глотается, ответ моста доходит вызывающему.
const RELAY_ACTIONS = ["openVerifyUrl", "openLogs", "quit", "windowDrag", "windowMinimize", "windowClose"];

const rec = (...pairs) => Object.fromEntries(pairs);
const nulls = (...keys) => rec(...keys.map((k) => [k, null]));
const blank = (v) => v ?? "";
const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);
const at = (screen, rest) => ({ screen, ...rest });
const into = (s, key, changes) => ({ [key]: { ...s[key], ...changes } });

export const freshDownload = () =>
  rec(["files", {}], ["overallReceived", 0], ["overallTotal", 0], ["attempt", 1], ["online", true]);

export const initialState = () =>
  rec(
    ["mode", "install"], ["lang", "ru"], ["screen", "boot"], ["frame", "custom"], ["init", null],
    ["code", ""], ["rejected", []], ["truncated", false], ["submitting", false], ["fieldError", null],
    ["choosingDir", false], ["folderError", null], ["notice", null], ["lastCode", ""], ["confirm", null],
    ["confirmed", null], ["selected", null],
    ["options", rec(["desktopShortcut", true], ["startMenu", true])],
    ["download", freshDownload()],
    ["install", rec(["phase", "verify"], ["percent", 0], ["overall", 0])],
    ["done", null], ["error", null], ["dialog", null], ["langOpen", false],
    [
      "update",
      rec(
        ["fromVersion", ""], ["toVersion", ""], ["channel", ""], ["phase", null],
        ["percent", 0], ["overall", 0], ["result", null], ["rolledback", null],
      ),
    ],
    [
      "side",
      rec(
        ["channel", ""], ["fromChannel", ""], ["version", ""], ["viaLauncher", false],
        ["phase", null], ["percent", null], ["overall", null], ["result", null],
      ),
    ],
    [
      "uninstall",
      rec(
        ["channel", ""], ["installed", []], ["deleteUserData", false], ["phase", "files"],
        ["percent", 0], ["removedUserData", false], ["userDataDirs", []], ["appRunning", false],
      ),
    ],
  );

// Хранилище языка на localStorage окна: недоступно или закрыто — тихо ничего не помним.
const guarded = (fallback, run) => {
  try {
    return run();
  } catch {
    return fallback;
  }
};
const windowStorage = () => ({
  get: (key) => guarded(null, () => window.localStorage.getItem(key)),
  set: (key, value) => guarded(undefined, () => window.localStorage.setItem(key, value)),
});

// Страница ошибки: одна и та же для события `error` и для отказов вызовов.
const errorPatch = (err, stage) =>
  at("error", {
    submitting: false,
    dialog: null,
    error: rec(
      ["presented", presentError(err, stage)],
      ["rawCode", err?.code ? String(err.code) : ""],
      ["httpStatus", err?.httpStatus ?? null],
      ["stage", stage],
    ),
  });

// Поля подсостояния режима из ответа `init`: [поле подсостояния, поле init, приведение].
const VIEW_FIELDS = {
  update: [["fromVersion", "fromVersion", blank], ["toVersion", "toVersion", blank], ["channel", "channel", blank]],
  side: [
    ["channel", "channel", blank], ["fromChannel", "fromChannel", blank],
    ["version", "toVersion", blank], ["viaLauncher", "viaLauncher", Boolean],
  ],
  uninstall: [
    ["channel", "channel", blank],
    ["installed", "installed", (v) => (Array.isArray(v) ? v : [])],
    ["userDataDirs", "userDataDirs", (v) => v ?? []],
    ["appRunning", "appRunning", Boolean],
  ],
};
// Экран у режимов update/side/uninstall называется так же, как режим.
function viewPatch(mode, init, s) {
  if (mode === "install") return { screen: init.existing ? "existing" : "welcome" };
  const fields = VIEW_FIELDS[mode].map(([to, from, cast]) => [to, cast(init[from])]);
  return at(mode, into(s, mode, rec(...fields)));
}

// Срок кода: секунды надёжнее метки, потому что метка выдана по часам ПК (DPOP_INVALID).
function deadlineOf({ expiresInSec: secs, expiresAt: stamp }) {
  const viaSeconds = typeof secs === "number" && secs > 0 && secs < Infinity ? Date.now() + secs * 1000 : NaN;
  const viaStamp = typeof stamp === "string" ? Date.parse(stamp) : NaN;
  return [viaSeconds, viaStamp].find((ms) => !Number.isNaN(ms)) ?? Date.now() + CODE_TTL_MS;
}

const codeAcceptedPatch = (reply) =>
  at("confirm", {
    submitting: false,
    confirm: rec(
      ["userCode", formatUserCode(reply.userCode)],
      ["verifyUrl", reply.verifyUrl ?? ""],
      ["deadline", deadlineOf(reply)],
      ["online", true],
    ),
  });

function codeRefusedPatch(err) {
  const { code, retryAfterSec: wait } = presentError(err, "submit");
  const until = wait ? Date.now() + wait * 1000 : 0;
  return { submitting: false, fieldError: rec(["code", code], ["retryAfterSec", wait], ["until", until]) };
}

// Ответ окна выбора папки, применённый к состоянию В МОМЕНТ ОТВЕТА, а не вызова.
function folderPatch(s, reply) {
  if (!reply || reply.canceled) return { choosingDir: false };
  const holder = s.confirmed ? "confirmed" : "init";
  const written = [["installDir", reply.installDir]];
  if (Number.isFinite(reply.freeBytes)) written.push(["freeBytes", reply.freeBytes]);
  if (holder === "confirmed" && Array.isArray(reply.channels)) written.push(["channels", reply.channels]);
  return { choosingDir: false, [holder]: { ...s[holder], ...rec(...written) } };
}

function confirmedPatch(s, data) {
  const names = branchList(data).map((b) => b.channel);
  const own = data?.channel;
  const hinted = [data?.hintChannel, s.init?.hintChannel].find((h) => names.includes(h));
  const candidates = [hinted, names.includes(own) ? own : undefined, names[0], own];
  return at(names.length > 1 ? "branch" : "ready", {
    confirm: null,
    confirmed: data,
    selected: candidates.find((v) => v !== undefined && v !== null) ?? null,
    error: null,
  });
}

// Правила событий хоста: (имя, состояние, данные) → патч или null.
// Ни одно правило не сверяется с текущим экраном: экран определяет последнее событие.
function eventPatch(name, s, d) {
  switch (name) {
    case "activation.confirmed":
      return confirmedPatch(s, d);
    case "activation.expired":
      return at("welcome", { notice: "expired", submitting: false, code: s.lastCode || s.code, ...nulls("confirm") });
    case "connection": {
      const on = Boolean(d.online);
      if (s.screen === "confirm" && s.confirm) return into(s, "confirm", { online: on });
      return s.screen === "download" ? into(s, "download", { online: on }) : null;
    }
    case "download.progress": {
      const carried = ["overallReceived", "overallTotal", "attempt"].map((k) => [k, d[k] ?? s.download[k]]);
      const files = { ...s.download.files, [d.file]: d };
      return at(s.screen === "install" ? "install" : "download", {
        download: rec(["files", files], ...carried, ["online", true]),
      });
    }
    case "download.queue": {
      // Сервер занят: очередь, а не ошибка. Хост ждёт сам и повторяет; окно показывает отсчёт до следующей попытки.
      const wait = Number(d?.waitSec);
      const queue = Number.isFinite(wait) && wait >= 0 ? rec(["until", Date.now() + wait * 1000], ["waitSec", wait]) : null;
      return at("download", into(s, "download", { queue, online: true }));
    }
    case "install.progress":
      return at("install", { install: d });
    case "done":
      return at("done", { done: d, dialog: null });
    case "error":
      return errorPatch(d, d?.stage ?? "install");
    case "window.closeRequested":
      return { dialog: CLOSE_DIALOG.get(s.mode) ?? "busy-uninstall" };
    case "update.progress": {
      const { phase, percent, overall } = d;
      return into(s, "update", { phase, percent, overall: overall ?? percent });
    }
    case "update.rolledback":
      return { ...into(s, "update", { result: "rolledback", rolledback: d }), dialog: null };
    case "update.done": {
      const toVersion = d?.version ?? s.update.toVersion;
      return { ...into(s, "update", { result: "done", toVersion, overall: 100 }), dialog: null };
    }
    case "side.progress":
      return at(
        "side",
        into(s, "side", {
          phase: d?.phase ?? s.side.phase,
          percent: finiteOrNull(d?.percent),
          overall: finiteOrNull(d?.overall),
          version: d?.version || s.side.version,
        }),
      );
    case "side.done":
      return {
        ...at("side", into(s, "side", {
          result: "done",
          channel: d?.channel ?? s.side.channel,
          version: d?.version ?? s.side.version,
          overall: 100,
        })),
        dialog: null,
      };
    case "uninstall.progress": {
      const { phase, percent } = d;
      return at("uninstall-progress", into(s, "uninstall", { phase, percent }));
    }
    case "uninstall.done":
      return at("uninstall-done", into(s, "uninstall", { removedUserData: Boolean(d?.removedUserData) }));
    default:
      return null;
  }
}

export function createApp({ bridge, params = new URLSearchParams(), storage = windowStorage() }) {
  const initial = initialState();
  const store = createStore(initial);
  const put = (patch) => store.set(patch);
  const ask = (method, args) => bridge.call(method, args);
  // Вызовы, не влияющие на ход: отказ молча превращается в undefined.
  // Синхронное исключение моста уходит вызывающему (так мост себя не ведёт).
  const quiet = (method, args) => Promise.resolve(ask(method, args)).catch(() => undefined);
  // Вызов с исходом: синхронное исключение моста считается отказом. Аргументы можно
  // отдать функцией — тогда они считаются уже внутри защиты.
  const outcome = (method, args) =>
    new Promise((resolve) => resolve(ask(method, typeof args === "function" ? args() : args))).then(
      (value) => ({ failed: false, value }),
      (err) => ({ failed: true, err }),
    );

  const offs = EVENT_NAMES.map((name) =>
    bridge.on(name, (data) => {
      const patch = eventPatch(name, store.get(), data);
      if (patch) put(patch);
    }),
  );

  async function boot({ trustHost = false } = {}) {
    const res = await outcome("init");
    if (res.failed) {
      put(errorPatch(res.err, "init"));
      return;
    }
    // Поля читаются безусловно: пустой ответ даёт TypeError при любом адресе.
    const { mode: hostMode, frame: hostFrame, osLocale } = res.value;
    const mode = [trustHost ? null : params.get("mode"), hostMode].find((m) => MODES.includes(m)) ?? "install";
    const saved = storage.get(LANG_KEY);
    const lang = [params.get("lang"), saved].find((c) => isLanguage(c)) ?? pickLanguage(osLocale);
    const frame = [params.get("frame"), hostFrame].includes("native") ? "native" : "custom";
    put({ init: res.value, mode, lang, frame, ...viewPatch(mode, res.value, store.get()) });
  }

  function setLanguage(code) {
    if (isLanguage(code)) {
      storage.set(LANG_KEY, code);
      put({ lang: code, langOpen: false });
      quiet("setLocale", { lang: code });
    }
  }

  async function submitCode() {
    const snapshot = store.get();
    const body = snapshot.code;
    // Открытый режим (init().open): кода нет, хост берёт его из имени файла или спрашивает подтверждение в браузере.
    const open = snapshot.init?.open === true;
    if (snapshot.submitting || (!open && !isCodeComplete(body))) return undefined;
    put({ lastCode: body, submitting: true, ...nulls("fieldError", "notice") });
    const res = await outcome("submitCode", () => (open ? {} : { code: fullCode(body) }));
    if (res.failed) {
      put(codeRefusedPatch(res.err));
      return undefined;
    }
    try {
      put(codeAcceptedPatch(res.value));
    } catch (caught) {
      put(codeRefusedPatch(caught));
    }
    return undefined;
  }

  // «Отменить» на подтверждении: сначала ждём хост, потом возвращаем ввод кода.
  async function cancelConfirm() {
    await quiet("cancelActivation");
    put(at("welcome", nulls("confirm", "fieldError", "notice")));
  }

  // «С начала»: код возвращается именно отправленный (lastCode), а не набранный за время запроса.
  function restart() {
    quiet("cancelActivation");
    const sentCode = store.get().lastCode;
    put(
      at("welcome", {
        code: sentCode,
        download: freshDownload(),
        rejected: [],
        submitting: false,
        truncated: false,
        ...nulls("fieldError", "notice", "confirm", "confirmed", "error", "dialog"),
      }),
    );
  }

  async function chooseInstallDir() {
    const { confirmed, selected, lang } = store.get();
    const listed = branchList(confirmed).some((b) => b.channel === selected);
    const channel = listed ? selected : confirmed?.channel || "";
    put({ choosingDir: true, folderError: null });
    const res = await outcome("chooseInstallDir", rec(["channel", channel], ["title", createTranslator(lang)("ready.pickTitle")]));
    if (res.failed) {
      put({ choosingDir: false, folderError: res.err?.code || "INTERNAL" });
      return undefined;
    }
    return put(folderPatch(store.get(), res.value));
  }

  async function startInstall() {
    const { options, selected, confirmed } = store.get();
    // Ветка уходит хосту, только если она есть в его списке (старый хост списка не знает).
    const known = branchList(confirmed).some((b) => b.channel === selected);
    const args = rec(
      ...(known ? [["channel", selected]] : []),
      ["desktopShortcut", options.desktopShortcut],
      ["startMenu", options.startMenu],
    );
    put(at("download", { download: freshDownload(), ...nulls("error", "dialog") }));
    const res = await outcome("startInstall", args);
    if (res.failed) put(errorPatch(res.err, "install"));
  }

  async function confirmCancel() {
    put({ dialog: null });
    await quiet("cancelInstall");
    restart();
  }

  async function uninstall() {
    const prev = store.get().uninstall;
    put(at("uninstall-progress", into(store.get(), "uninstall", { phase: "files", percent: 0, appRunning: false })));
    // Данные общие, пока стоит другая ветка: их не трогаем при любой галочке.
    const res = await outcome("uninstall", { deleteUserData: prev.installed.length > 0 ? false : prev.deleteUserData });
    if (!res.failed) return;
    const stillRunning = String(res.err?.code).toUpperCase() === "APP_RUNNING";
    put(stillRunning ? at("uninstall", into(store.get(), "uninstall", { appRunning: true })) : errorPatch(res.err, "uninstall"));
  }

  async function enterCode() {
    const res = await outcome("enterCode");
    if (res.failed) {
      put(errorPatch(res.err, "side"));
      return;
    }
    put(initialState());
    await boot({ trustHost: true });
  }

  // Что повторять после ошибки — решает этап, на котором она случилась.
  function retry() {
    switch (store.get().error?.stage) {
      case "download":
      case "install":
        return startInstall();
      case "uninstall":
        return uninstall();
      default:
        return restart();
    }
  }

  // Высота, которую страница просила последней (у каждого окна своя); 600 — исходная.
  let askedHeight = 600;
  function fitWindow(height) {
    if (height !== askedHeight) {
      askedHeight = height;
      quiet("fitWindow", { height });
    }
  }

  function confirmClose() {
    put({ dialog: null });
    return quiet("quit");
  }

  const impl = {
    ...Object.fromEntries(Object.entries(PATCH_ACTIONS).map(([name, patch]) => [name, () => put(patch)])),
    ...Object.fromEntries(RELAY_ACTIONS.map((name) => [name, () => quiet(name)])),
    boot,
    setLanguage,
    toggleLang: () => put({ langOpen: !store.get().langOpen }),
    editCode: ({ body, rejected = [], truncated = false }) =>
      void put({ code: body, rejected, truncated, ...nulls("fieldError", "notice") }),
    submitCode,
    openSite: (page = "beta") => quiet("openSite", { page }),
    cancelConfirm,
    setOption: (name, value) => put(into(store.get(), "options", { [name]: Boolean(value) })),
    chooseBranch: (channel) => put({ selected: channel }),
    chooseInstallDir,
    startInstall,
    confirmCancel,
    confirmClose,
    retry,
    restart,
    fitWindow,
    launch: (channel) => quiet("launch", rec(["lang", store.get().lang], ...(isBranch(channel) ? [["channel", channel]] : []))),
    enterCode,
    // «Повторить» при «нет связи с сервером»: хост спрашивает сервер о доступе заново.
    recheck: () => boot(),
    setDeleteUserData(value) {
      const shared = store.get().uninstall.installed.length > 0;
      return put(into(store.get(), "uninstall", { deleteUserData: shared ? false : Boolean(value) }));
    },
    uninstall,
  };
  const actions = rec(...ACTION_ORDER.map((name) => [name, impl[name]]));

  const destroy = () => {
    // Повторный вызов снова зовёт все отписки: мост сам решает, что с ними делать.
    offs.forEach((off) => off?.());
  };

  return { store, actions, boot, destroy };
}
