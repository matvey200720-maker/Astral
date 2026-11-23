"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const ROOT = "astral:part-shooter";
const [SHOOT, SHOT, READY] = ["shoot", "shot", "ready"].map((suffix) => `${ROOT}:${suffix}`);

// Слушатель отдаёт странице только номер и просьбу, служебное событие остаётся здесь.
const forwardTo = (callback) => (_event, id, request) => callback(id, request);

const bridge = {
  onShoot: (callback) => {
    ipcRenderer.on(SHOOT, forwardTo(callback));
  },
  reply: (id, result) => {
    ipcRenderer.send(SHOT, id, result);
  },
  ready: () => {
    ipcRenderer.send(READY);
  },
};

contextBridge.exposeInMainWorld("astralPartShooter", bridge);
