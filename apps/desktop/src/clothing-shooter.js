import * as nodeUrl from "node:url";

import * as shotRequest from "@modovik/clothing/shot-request";

import { createServiceShooterHost } from "./service-shooter-host.js";
import { isServiceWindow } from "./service-windows.js";

const CHANNEL_NAMES = ["shoot", "shot", "ready"];
const NO_WINDOW = "Окно Astral закрыто — снимать некому.";

// Запрос работника одежды -> запрос снимка (без ссылок на ресурс модели).
function requestFrom(request) {
  return shotRequest.shotRequestOf(request.drawable, request);
}

// Ответ окна -> байты, обложка и число детализации (ложное число — 0).
function frameFrom(reply) {
  const bytes = new Uint8Array(reply.bytes);
  let cover = null;
  if (reply.cover) {
    cover = new Uint8Array(reply.cover);
  }
  const detail = Number(reply.detail) || 0;
  return { bytes, cover, detail };
}

export function createClothingShooterHost(options) {
  const channels = Object.fromEntries(
    CHANNEL_NAMES.map((name) => [name, `astral:clothing-shooter:${name}`]),
  );
  // Новые функции на каждое создание: хозяин не должен делить их с другим экземпляром.
  function requestOf(request) {
    return requestFrom(request);
  }
  function resultOf(reply) {
    return frameFrom(reply);
  }
  return createServiceShooterHost(Object.assign({}, options, { channels, requestOf, resultOf }));
}

// Первое окно интерфейса: первое, чьё значение не служебное окно. Найденный ложный элемент списка тоже считается.
function interfaceWindow(BrowserWindow) {
  for (const candidate of BrowserWindow.getAllWindows()) {
    if (!isServiceWindow(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function pageAddress(BrowserWindow) {
  const page = interfaceWindow(BrowserWindow);
  const missing = page === undefined || page === null;
  const address = missing ? undefined : page.webContents.getURL();
  if (!address) {
    throw new Error(NO_WINDOW);
  }
  return new URL("/app?service=clothing-shooter", address).href;
}

// Последнее окно интерфейса закрылось: скрытое окно не должно держать приложение.
function closeWithInterface(app, BrowserWindow, host) {
  const noneLeft = () => !interfaceWindow(BrowserWindow);
  function onCreated(_event, window) {
    window.once("closed", () => {
      if (noneLeft()) {
        host.close();
      }
    });
  }
  app.on("browser-window-created", onCreated);
}

export function desktopClothingShooter(deps) {
  const { app, BrowserWindow, ipcMain } = deps;
  const preload = nodeUrl.fileURLToPath(new URL("./clothing-shooter-preload.cjs", import.meta.url));
  const host = createClothingShooterHost({
    BrowserWindow,
    ipcMain,
    url() {
      return pageAddress(BrowserWindow);
    },
    preload,
  });
  closeWithInterface(app, BrowserWindow, host);
  return host;
}
