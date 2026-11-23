// Скрытое окно-служба для снимков (WebGL): поднимается по первой заявке,
// обслуживает заявки и закрывается, когда заявки кончились.
import { markServiceWindow } from "./service-windows.js";

const DEFAULT_INFO_GLOBAL = "__astralShooterInfo";
const DEFAULT_READY_MS = 30000;
const DEFAULT_SHOT_MS = 60000;
const DEFAULT_IDLE_MS = 30000;
const WINDOW_SIDE = 64;
const SAFE_PREFERENCES = { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };

const passThrough = (value) => value;
const seconds = (ms) => Math.round(ms / 1000);

// Переменная окружения читается при создании хозяина; годится только число больше нуля.
function idleFromEnvironment() {
  const value = Number(process.env.ASTRAL_SHOOTER_IDLE_MS);
  return value > 0 && value < Infinity ? value : DEFAULT_IDLE_MS;
}

function windowOptions(preload) {
  return {
    show: false,
    width: WINDOW_SIDE,
    height: WINDOW_SIDE,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: { preload, ...SAFE_PREFERENCES },
  };
}

function destroyIfAlive(win) {
  if (win && !win.isDestroyed()) win.destroy();
}

/** Состояние хозяина: текущее окно, заявки в полёте и таймер простоя. */
class Station {
  #o;
  #current = null; // окно: открывающееся или рабочее
  #lastId = 0; // нумерация заявок сквозная на хозяина
  #idleTimer = null;
  #pending = new Map(); // номер заявки -> { resolve, reject, timer }

  constructor(options) {
    this.#o = options;
  }

  #rejectAll(error) {
    const records = [...this.#pending.values()];
    this.#pending.clear();
    for (const { timer, reject } of records) {
      clearTimeout(timer);
      reject(error);
    }
  }

  // Провал окна: слушатель и таймер снимаются, заявки текущего окна отклоняются, окно уничтожается.
  #abandon(session, error) {
    this.#o.ipcMain.removeListener(this.#o.ready, session.onReady);
    clearTimeout(session.timer);
    if (this.#current === session) {
      this.#current = null;
      this.#rejectAll(error);
    }
    destroyIfAlive(session.win);
    session.rejectOpen(error);
  }

  // Окно закрыто (событие closed): уничтожать его уже не нужно.
  #closed(session) {
    this.#o.ipcMain.removeListener(this.#o.ready, session.onReady);
    clearTimeout(session.timer);
    if (this.#current !== session) return;
    this.#current = null;
    const error = new Error("Окно снимков закрыто.");
    session.rejectOpen(error);
    this.#rejectAll(error);
  }

  #startWindow() {
    const { BrowserWindow, ipcMain, url, preload, ready, readyMs } = this.#o;
    const source = url;
    const address = source instanceof Function ? source() : source;
    const win = new BrowserWindow(windowOptions(preload));
    markServiceWindow(win);
    const { promise: opening, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers();
    const session = { win, ready: false, timer: null, onReady: null, opening, resolveOpen, rejectOpen };
    const contents = win.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    for (const blocked of ["will-navigate", "will-attach-webview"]) contents.on(blocked, (event) => event.preventDefault());
    const limit = `Окно снимков не открылось за ${seconds(readyMs)} с.`;
    session.timer = setTimeout(() => this.#abandon(session, new Error(limit)), readyMs);
    session.onReady = (event) => {
      if (event.sender !== contents) return;
      clearTimeout(session.timer);
      ipcMain.removeListener(ready, session.onReady);
      session.ready = true;
      resolveOpen(win);
    };
    ipcMain.on(ready, session.onReady);
    contents.on("render-process-gone", (_event, details) => {
      this.#abandon(session, new Error(`Окно снимков упало (${details?.reason || "сбой"}).`));
    });
    win.on("closed", () => this.#closed(session));
    win.loadURL(address).catch((error) => {
      this.#abandon(session, new Error(`Окно снимков не загрузилось: ${error?.message}`));
    });
    this.#current = session;
    return opening;
  }

  #openWindow() {
    const session = this.#current;
    const reusable = session !== null && (!session.ready || !session.win.isDestroyed());
    return reusable ? session.opening : this.#startWindow();
  }

  /** Отправляет заявку странице и ждёт ответ не дольше `shotMs`. */
  #shoot(win, payload) {
    const id = ++this.#lastId;
    return new Promise((resolve, reject) => {
      const expire = () => {
        this.#pending.delete(id);
        reject(new Error(`Снимок не пришёл за ${seconds(this.#o.shotMs)} с.`));
      };
      const timer = setTimeout(expire, this.#o.shotMs);
      this.#pending.set(id, { resolve, reject, timer });
      win.webContents.send(this.#o.shoot, id, payload);
    });
  }

  #armIdle() {
    if (this.#pending.size > 0) return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => this.close(), this.#o.idleMs);
  }

  /** Ответ страницы по каналу shot. */
  answer(event, id, result) {
    const session = this.#current;
    if (!session?.ready || event.sender !== session.win.webContents) return;
    if (!this.#pending.has(id)) return;
    const { resolve, reject, timer } = this.#pending.get(id);
    this.#pending.delete(id);
    clearTimeout(timer);
    const failure = result?.error;
    if (failure) reject(new Error(failure));
    else resolve(this.#o.resultOf(result));
  }

  async render(request) {
    clearTimeout(this.#idleTimer);
    const payload = this.#o.requestOf(request);
    const win = await this.#openWindow();
    return this.#shoot(win, payload).finally(() => this.#armIdle());
  }

  close() {
    clearTimeout(this.#idleTimer);
    const session = this.#current;
    this.#current = null;
    this.#rejectAll(new Error("Окно снимков закрыто."));
    destroyIfAlive(session?.win);
  }

  async stats() {
    const session = this.#current;
    const win = session?.ready ? session.win : null;
    if (!win || win.isDestroyed()) return { open: false, pid: null, info: null };
    let info = null;
    try {
      info = await win.webContents.executeJavaScript(`globalThis.${this.#o.infoGlobal}?.() ?? null`, true);
    } catch {
      info = null;
    }
    return { open: true, pid: win.webContents.getOSProcessId(), info };
  }
}

export function createServiceShooterHost({
  BrowserWindow,
  ipcMain,
  url,
  preload,
  channels,
  requestOf = passThrough,
  resultOf = passThrough,
  infoGlobal = DEFAULT_INFO_GLOBAL,
  readyMs = DEFAULT_READY_MS,
  shotMs = DEFAULT_SHOT_MS,
  idleMs = idleFromEnvironment(),
}) {
  const { shoot, shot, ready } = channels;
  const station = new Station({ BrowserWindow, ipcMain, url, preload, shoot, ready, requestOf, resultOf, infoGlobal, readyMs, shotMs, idleMs });
  ipcMain.on(shot, (event, id, result) => station.answer(event, id, result));
  return {
    render: (request) => station.render(request),
    close: () => station.close(),
    stats: () => station.stats(),
  };
}
