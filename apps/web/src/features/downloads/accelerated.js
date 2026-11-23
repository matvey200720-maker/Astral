import { useSyncExternalStore } from "react";

const STORAGE_KEY = "astral.downloads.accelerated.v1";

function loadChoice() {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistChoice(on) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Хранилища нет или оно закрыто: выбор живёт до перезапуска окна.
  }
}

// Хранилище читается один раз, при загрузке модуля; дальше правда — в памяти.
const choice = { on: loadChoice(), watchers: new Set() };

function watch(listener) {
  choice.watchers.add(listener);
  return () => {
    choice.watchers.delete(listener);
  };
}

export function downloadsAcceleratedNow() {
  return choice.on;
}

export function setDownloadsAcceleratedNow(next) {
  choice.on = next === true;
  persistChoice(choice.on);
  for (const listener of [...choice.watchers]) listener();
  return choice.on;
}

export function useDownloadsAccelerated() {
  return useSyncExternalStore(
    watch,
    downloadsAcceleratedNow,
    downloadsAcceleratedNow,
  );
}
