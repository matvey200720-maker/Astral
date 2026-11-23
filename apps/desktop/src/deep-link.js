import { app } from "electron";
import path from "node:path";
import contractsIpc from "@modovik/contracts/ipc";
import * as appWindow from "./app-window.js";
import * as linkArgs from "./deep-link-args.js";

const { IPC_CHANNELS } = contractsIpc;

export { deepLinkFromArgs } from "./deep-link-args.js";

// Один ящик на процесс: окно может загрузиться позже, чем придёт ссылка.
const mailbox = linkArgs.createDeepLinkMailbox();

// Окно готово принять ссылку: страница не грузится и это не заглушка data:.
function readyForLink(win) {
  const loading = win.webContents.isLoading();
  if (loading) return false;
  return !win.webContents.getURL().startsWith("data:");
}

// Отдать ссылку окну и очистить ящик.
function handOver(win, link) {
  const { webContents } = win;
  webContents.send(IPC_CHANNELS.DEEP_LINK, link);
  mailbox.clear();
}

// Пришедшая ссылка: кладём в ящик; окно поднимаем, только если ссылка есть; отдаём, когда оно готово.
function deliver(value) {
  const link = mailbox.put(value);
  const win = link ? appWindow.raiseAppWindow() : null;
  if (win && readyForLink(win)) handOver(win, link);
}

// Хвост вызова: в разработке системе нужно сказать, чем запускать скрипт.
function launchTail() {
  const script = process.defaultApp ? process.argv[1] : undefined;
  return script ? [process.execPath, [path.resolve(script)]] : [];
}

export function dispatchDeepLink(value) {
  return deliver(value);
}

// Как сказать системе, что `astral://` наш.
export function registerAstralProtocol() {
  return app.setAsDefaultProtocolClient("astral", ...launchTail());
}

export function rememberStartupDeepLink(...given) {
  const [args = process.argv] = given;
  return mailbox.remember(args);
}

export function pendingDeepLink() {
  return mailbox.take();
}
