/*
 * «Мои замены» окна «Анимации» (ТЗ 29.10.2026-d): что человек решил играть вместо чего. Хранится в браузерном хранилище окна
 * (`localStorage`, как «Мои работы» без сервера) и переживает перезапуск приложения.
 *
 * Замена — пара описаний анимаций: `target` — что заменяем (то, что играет на сервере), `replacement` — что играть вместо.
 * Описания хранятся целиком, чтобы предпросмотр открывался без списка игры. Попадание в игру отмечено `installed`: его ставит окно после
 * установки (`animation-install-flow.js`) и сверяет с игрой при открытии; правда о том, что стоит, — в состоянии главного процесса
 * (`installed.json`), окно только держит отметку для списка.
 */

import { useSyncExternalStore } from "react";
import { entryRequest } from "./animation-library.js";

const KEY = "astral.animations.replacements.v1";
const LIMIT = 200;

const listeners = new Set();
let snapshot = null;

const slim = (entry) => ({ ...entryRequest(entry), name: entry.name, section: entry.section });

function load() {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((item) => item?.id && item.target?.id && item.replacement?.id) : [];
  } catch {
    return [];
  }
}

function write(list) {
  snapshot = list;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
  } catch {
    /* Хранилище закрыто (приватное окно, выключенное) — замены живут до закрытия окна. */
  }
  for (const listener of listeners) listener();
}

export const readReplacements = () => (snapshot ||= load());

/** Заменить `target` на `replacement`: одна замена на анимацию — новая вытесняет прежнюю. */
export function saveReplacement(target, replacement) {
  const item = {
    id: target.id,
    target: slim(target),
    replacement: slim(replacement),
    createdAt: Date.now(),
    installed: false,
  };
  write([item, ...readReplacements().filter((current) => current.id !== item.id)].slice(0, LIMIT));
  return item;
}

/** Отметить, стоит ли замена в игре. */
export function markInstalled(id, installed) {
  const list = readReplacements();
  if (!list.some((item) => item.id === id && Boolean(item.installed) !== installed)) return;
  write(list.map((item) => (item.id === id ? { ...item, installed } : item)));
}

/** Свериться с игрой: стоят только замены из `present` (множество номеров); остальные — не в игре. */
export function syncInstalled(present) {
  const list = readReplacements();
  if (!list.some((item) => Boolean(item.installed) !== present.has(item.id))) return;
  write(list.map((item) => ({ ...item, installed: present.has(item.id) })));
}

export function removeReplacement(id) {
  write(readReplacements().filter((item) => item.id !== id));
}

/** Для проверок: забыть всё и перечитать хранилище. */
export function resetReplacements() {
  snapshot = null;
  for (const listener of listeners) listener();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useReplacements = () => useSyncExternalStore(subscribe, readReplacements, readReplacements);
