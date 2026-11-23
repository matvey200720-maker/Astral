"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL_PREFIX = "astral:gunpack-shooter:";
const channel = (name) => CHANNEL_PREFIX + name;

// Страница получает только просьбы на съёмку, ответ и сигнал готовности.
contextBridge.exposeInMainWorld("astralGunpackShooter", {
  onShoot: (callback) => {
    ipcRenderer.on(channel("shoot"), function (_event, id, request) {
      return callback(id, request);
    });
  },
  reply: (id, result) => {
    ipcRenderer.send(channel("shot"), id, result);
  },
  ready: () => {
    ipcRenderer.send(channel("ready"));
  },
});
