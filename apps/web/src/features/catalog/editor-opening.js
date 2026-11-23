import { useSyncExternalStore } from "react";

// Страховка: в спрятанном окне кадров нет, ждать их вечно нельзя.
const FRAME_FALLBACK_MS = 80;
// После удачного открытия экран держится, чтобы страница не мигнула.
const HOLD_AFTER_OPEN_MS = 400;

// Что сейчас открывается: объект `info` вызывающего или null.
let opening = null;
const listeners = new Set();

function setOpening(next) {
  opening = next;
  for (const listener of [...listeners]) listener();
}

// Экран снимается, только если на нём всё ещё тот же `info` (сравнение по ссылке).
function release(info) {
  if (opening === info) setOpening(null);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readOpening = () => opening;

export function useEditorOpening() {
  return useSyncExternalStore(subscribe, readOpening, readOpening);
}

export function afterFirstFrame() {
  return new Promise((resolve) => {
    const done = () => resolve();
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => setTimeout(done, 0));
    }
    setTimeout(done, FRAME_FALLBACK_MS);
  });
}

export function closeEditorOpening() {
  if (!opening) return;
  setOpening(null);
}

export async function openingEditor(info, run) {
  if (opening) return false;
  setOpening(info);
  let opened;
  try {
    await afterFirstFrame();
    opened = Boolean(await run());
  } catch (error) {
    release(info);
    throw error;
  }
  if (opened) setTimeout(() => release(info), HOLD_AFTER_OPEN_MS);
  else release(info);
  return opened;
}
