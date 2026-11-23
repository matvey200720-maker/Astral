/*
 * Паки «Интерьеров проектов» из облачного каталога — отдельно от обычных полок.
 *
 * Паки приходят в каталоге v2 обычными модами (раздел `project-interiors`), но
 * это данные редактора, а не моды: `api.js` отрезает их от каталога на входе
 * (`splitProjectPacks`) и кладёт сюда, поэтому полки, поиск, библиотека и
 * установка их не видят. Редактор читает отсюда список паков.
 *
 * Модуль без зависимостей от `api.js`: его читает `api.js`.
 */

import { readProjectPack, splitProjectPacks } from "@modovik/climb-contract/recolor/project-interiors-packs";

let mods = [];
let closed = false;
const listeners = new Set();
let snapshot = Object.freeze({ packs: Object.freeze([]), closed: false });

function publish() {
  snapshot = Object.freeze({
    packs: Object.freeze(mods.map(readProjectPack).filter(Boolean)),
    closed,
  });
  for (const listener of listeners) listener();
}

/** Текущее состояние: `{ packs, closed }`. Объект меняется только вместе с данными (для `useSyncExternalStore`). */
export const projectPackSnapshot = () => snapshot;

export function subscribeProjectPacks(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Каталог из облака: отрезает паки (их получает редактор) и отдаёт остальное.
 * `partial` — первые страницы, пока идут остальные: паки только добавляются,
 * полный каталог заменяет список целиком. Каталог, который сервер закрыл для
 * этого аккаунта (бета: «только команде»), редактор называет прямо.
 */
export function takeProjectPacks(catalog) {
  if (!catalog || typeof catalog !== "object") return catalog;
  const partial = catalog.partial === true;
  const { catalog: rest, packs } = splitProjectPacks(catalog);
  const nextClosed = catalog.source === "astral-catalog-closed";
  if (partial) {
    const known = new Map(mods.map((mod) => [mod.id, mod]));
    for (const mod of packs) known.set(mod.id, mod);
    mods = [...known.values()];
  } else mods = packs;
  closed = nextClosed;
  publish();
  return rest;
}

/** Для тестов и песочницы: задать список вручную. */
export function setProjectPackMods(next, { closed: isClosed = false } = {}) {
  mods = Array.isArray(next) ? next : [];
  closed = isClosed;
  publish();
}
