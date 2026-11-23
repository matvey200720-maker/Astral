import { randomBytes, timingSafeEqual } from "node:crypto";
import { observeIpc } from "./app-log.js";
import { watchHandler } from "./main-watchdog.js";

export function parseDownloadHostAllowlist(value) {
  return String(value || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function createElectronBoundary({ ipcMain, assertIpcArguments, crashGuard = null }) {
  const ipcNonce = randomBytes(32).toString("base64url");
  let trustedRendererContents = null;
  let trustedRendererOrigin = "";

  const validNonce = (value) => {
    const supplied = Buffer.from(String(value || ""), "utf8");
    const expected = Buffer.from(ipcNonce, "utf8");
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  };

  const allowedRenderer = (raw) => {
    try {
      const url = new URL(raw);
      return url.origin === trustedRendererOrigin;
    } catch {
      return false;
    }
  };

  /*
   * Каналы, чьи модули ещё грузятся (задача 6 ТЗ 08.10, вечер): модули
   * мастерской, публикации и установок подключаются после показа окна
   * (`deferred-ipc.js`), и вызов, пришедший раньше регистрации, ждёт её, а не
   * падает «No handler registered». `expectIpc` ставит ожидание на каналы,
   * которых ещё никто не взял; `settleIpc` после подключения снимает
   * оставшиеся — у них отказ сразу, как и было без ожидания.
   */
  const handled = new Set();
  const waiting = new Map();

  /*
   * Скорость 12.10: окно открывается, пока главный процесс ещё
   * восстанавливает прерванное прошлым запуском (журналы движка, корзина,
   * подмена архивов — разбор состояния установок занимает сотни
   * миллисекунд). Вызовы окна в это время ждут (`holdIpc` → `releaseIpc`),
   * так что ни один обработчик не увидит состояние до восстановления.
   */
  let held = null;
  let release = null;
  const holdIpc = () => {
    if (!held) held = new Promise((resolve) => (release = resolve));
  };
  const releaseIpc = () => {
    const done = release;
    held = null;
    release = null;
    done?.();
  };

  /* Отказ любого канала и ход установки видны в журнале приложения (Т-153);
     замирание главного потока посреди обработчика — тоже (`main-watchdog.js`).
     Запрос к файлам игры, посреди которого Astral дважды умер, третий раз
     отказывает словами (`ipc-crash-guard.js`). */
  const handleIpc = (channel, handler) => {
    const observed = watchHandler(channel, observeIpc(channel, crashGuard ? crashGuard.wrap(channel, handler) : handler));
    const guarded = (event, nonce, ...args) => {
      if (!validNonce(nonce)) throw new Error("Invalid IPC capability.");
      assertIpcArguments(channel, args);
      if (held) return held.then(() => observed(event, ...args));
      return observed(event, ...args);
    };
    const pending = waiting.get(channel);
    handled.add(channel);
    if (pending) {
      waiting.delete(channel);
      pending.resolve(guarded);
      return undefined;
    }
    return ipcMain.handle(channel, guarded);
  };

  /* `onCall` — что делать при первом вызове ждущего канала (например,
     начать грузить его модуль сейчас, а не по таймеру). */
  const expectIpc = (channels, { onCall = null } = {}) => {
    for (const channel of channels) {
      if (handled.has(channel) || waiting.has(channel)) continue;
      let resolve;
      let reject;
      const ready = new Promise((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      ready.catch(() => {});
      try {
        ipcMain.handle(channel, async (event, ...args) => {
          if (waiting.has(channel)) onCall?.(channel);
          return (await ready)(event, ...args);
        });
      } catch {
        /* у канала уже есть свой обработчик мимо границы — ждать нечего */
        continue;
      }
      waiting.set(channel, { resolve, reject });
    }
  };

  /* `filter` — какие из ждущих каналов отказывают (по умолчанию все): модули
     мастерской грузятся по первому вызову, и их каналы ждут дольше прочих. */
  const settleIpc = (filter = () => true) => {
    for (const [channel, pending] of waiting) {
      if (!filter(channel)) continue;
      pending.reject(new Error(`No handler registered for '${channel}'`));
      ipcMain.removeHandler(channel);
      waiting.delete(channel);
    }
  };

  const onIpc = (channel, handler) => {
    handled.add(channel);
    return ipcMain.on(channel, (event, nonce, ...args) => {
      if (!validNonce(nonce)) throw new Error("Invalid IPC capability.");
      assertIpcArguments(channel, args);
      return handler(event, ...args);
    });
  };

  const trusted = (event, handler) => {
    if (
      !trustedRendererContents ||
      event.sender !== trustedRendererContents ||
      event.senderFrame !== event.sender.mainFrame ||
      !allowedRenderer(event.senderFrame?.url)
    ) {
      throw new Error("Недоверенный источник IPC-запроса.");
    }
    return handler();
  };

  const bindRenderer = (webContents, webUrl) => {
    trustedRendererContents = webContents;
    trustedRendererOrigin = new URL(webUrl).origin;
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const blockUnexpectedNavigation = (event, target) => {
      if (!allowedRenderer(target)) event.preventDefault();
    };
    webContents.on("will-navigate", blockUnexpectedNavigation);
    webContents.on("will-redirect", blockUnexpectedNavigation);
    webContents.on("will-attach-webview", (event) => event.preventDefault());
  };

  return {
    ipcNonce,
    handleIpc,
    onIpc,
    trusted,
    bindRenderer,
    expectIpc,
    settleIpc,
    holdIpc,
    releaseIpc,
  };
}
