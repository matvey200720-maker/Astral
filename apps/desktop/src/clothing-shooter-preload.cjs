"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const WINDOW_KEY = "astralClothingShooter";
const CHANNEL_ROOT = "astral:clothing-shooter";

// Мост скрытого окна-съёмщика: три вызова, ничего лишнего через границу изоляции.
function shooterBridge(root) {
  const [toShoot, shotBack, readySignal] = ["shoot", "shot", "ready"].map((suffix) => `${root}:${suffix}`);
  return {
    onShoot: (callback) => {
      ipcRenderer.on(toShoot, function (_event, id, request) {
        return callback(id, request);
      });
    },
    reply: (id, result) => {
      ipcRenderer.send(shotBack, id, result);
    },
    ready: () => {
      ipcRenderer.send(readySignal);
    },
  };
}

contextBridge.exposeInMainWorld(WINDOW_KEY, shooterBridge(CHANNEL_ROOT));
