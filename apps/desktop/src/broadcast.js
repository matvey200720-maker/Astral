import ipcContract from "@modovik/contracts/ipc";
import { BrowserWindow } from "electron";
import { isServiceWindow } from "./service-windows.js";
import { sendEach } from "./window-send.js";

const { IPC_CHANNELS } = ipcContract;

// Окна интерфейса по порядку списка; уничтоженные и служебные пропускаются.
// Генератор ленивый: окну отправляют до того, как проверят следующее.
function* userWindows() {
  const windows = BrowserWindow.getAllWindows();
  for (let at = 0; at < windows.length; at += 1) {
    const window = windows[at];
    if (!window.isDestroyed() && !isServiceWindow(window)) yield window;
  }
}

function deliver(channel, data) {
  sendEach(userWindows(), channel, data);
}

export function broadcastFastInstall(event) {
  deliver(IPC_CHANNELS.FAST_INSTALL_EVENT, event);
}

export function broadcastRockstarDelivery(event) {
  deliver(IPC_CHANNELS.ROCKSTAR_DELIVERY_EVENT, event);
}

export function broadcastRockstarCopyProgress(progress) {
  deliver(IPC_CHANNELS.ROCKSTAR_COPY_PROGRESS, progress);
}

export function broadcastVanillaStatus(status) {
  deliver(IPC_CHANNELS.VANILLA_STATUS, status);
}

export function broadcastWorkshopProgress(status) {
  deliver(IPC_CHANNELS.WORKSHOP_PROGRESS, status);
}

export function broadcastWorkshopInstallProgress(status) {
  deliver(IPC_CHANNELS.WORKSHOP_INSTALL_PROGRESS, status);
}

export function broadcastOptimizationProgress(payload) {
  deliver(IPC_CHANNELS.OPTIMIZATION_PROGRESS, payload);
}

export function broadcastUpdates(state) {
  deliver(IPC_CHANNELS.UPDATES_EVENT, state);
}

export function broadcastChannels(state) {
  deliver(IPC_CHANNELS.CHANNELS_EVENT, state);
}

export function broadcastCloudCatalog(catalog) {
  deliver(IPC_CHANNELS.CLOUD_CATALOG_UPDATED, catalog);
}

export function broadcastGameCrash(event) {
  deliver(IPC_CHANNELS.GAME_CRASH_EVENT, event);
}

export function broadcastClothingRegistration(event) {
  deliver(IPC_CHANNELS.CLOTHING_REGISTRATION_EVENT, event);
}
