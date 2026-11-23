import { useSyncExternalStore } from "react";
import { tr } from "../../../../locales/ui.js";
import { normalizeOwnLook, normalizeOwnSet } from "@modovik/vector-map";

const STORAGE_KEY = "astral.world-map.own.v1";

const freezeValue = (sets, looks) => Object.freeze({
  sets: Object.freeze(sets),
  looks: Object.freeze(looks),
});

// Пустое значение при сбое чтения — одна ссылка на весь модуль.
const FAILED_READ = freezeValue([], []);
const serverSnapshot = () => FAILED_READ;

let cached = null;
const listeners = new Set();

function readStored() {
  try {
    const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) || "{}");
    const { sets, looks } = stored;
    return freezeValue(
      Array.isArray(sets) ? sets.map((entry) => normalizeOwnSet(entry)).filter(Boolean) : [],
      Array.isArray(looks) ? looks.map((entry) => normalizeOwnLook(entry)).filter(Boolean) : [],
    );
  } catch {
    return FAILED_READ;
  }
}

function isQuotaError(error) {
  return error?.name === "QuotaExceededError" || /quota/i.test(String(error?.message));
}

// Одна запись на действие, целиком. Квота уходит наружу, прочие сбои записи
// гасятся: запись остаётся только в памяти окна.
function commit(sets, looks) {
  const next = freezeValue(sets, looks);
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sets, looks }));
  } catch (error) {
    if (isQuotaError(error)) {
      throw new Error(
        tr("Не хватает места для своих наборов — удалите ненужные и сохраните снова."),
      );
    }
  }
  cached = next;
  for (const listener of [...listeners]) listener();
}

function upsert(list, entry) {
  const index = list.findIndex((item) => item.id === entry.id);
  if (index < 0) return [...list, entry];
  const copy = [...list];
  copy[index] = entry;
  return copy;
}

const without = (list, id) => list.filter((item) => item.id !== id);

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ownMapPresets() {
  if (cached === null) cached = readStored();
  return cached;
}

export function useOwnMapPresets() {
  return useSyncExternalStore(subscribe, ownMapPresets, serverSnapshot);
}

export function saveOwnSet(entry) {
  const { sets, looks } = ownMapPresets();
  commit(upsert(sets, entry), looks);
  return entry;
}

export function deleteOwnSet(id) {
  const { sets, looks } = ownMapPresets();
  commit(without(sets, id), looks);
}

export function saveOwnLook(entry) {
  const { sets, looks } = ownMapPresets();
  commit(sets, upsert(looks, entry));
  return entry;
}

export function deleteOwnLook(id) {
  const { sets, looks } = ownMapPresets();
  commit(sets, without(looks, id));
}

export function resetOwnMapPresetsForTests() {
  cached = null;
}
