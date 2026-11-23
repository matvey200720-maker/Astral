import { useSyncExternalStore } from "react";

const STORAGE_KEY = "astral.bundle.choices.v1";

// Один и тот же замороженный объект на все вызовы, где выбора нет.
const NO_CHOICE = Object.freeze({});

function restoreTable() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed !== null && typeof parsed === "object") return parsed;
  } catch {
    // хранилища нет или запись испорчена: начинаем с пустой таблицы
  }
  return {};
}

function persistTable(table) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // память уже обновлена, а хранилище недоступно или не принимает значение
  }
}

/**
 * Таблица «сборка → { группа → выбор }». Из хранилища читается один раз
 * (в том числе неудачно), дальше живёт в памяти окна.
 */
class ChoiceStore {
  #table = null;

  #listeners = new Set();

  get table() {
    this.#table ??= restoreTable();
    return this.#table;
  }

  pick(bundleId) {
    return this.table[bundleId] || NO_CHOICE;
  }

  record(bundleId, group, modId) {
    if (!bundleId || !group) return;

    const before = this.table;
    // Обычные собственные поля даже для «__proto__» и «constructor»: ключи вычисляемые.
    const row = { ...before[bundleId], [group]: modId };
    this.#table = { ...before, [bundleId]: row };
    persistTable(this.#table);

    for (const notify of [...this.#listeners]) notify();
  }

  subscribe = (listener) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
}

const store = new ChoiceStore();

const serverSnapshot = () => NO_CHOICE;

export function bundleChoices(bundleId) {
  return store.pick(bundleId);
}

export function chooseBundleVariant(bundleId, group, modId) {
  store.record(bundleId, group, modId);
}

export function useBundleChoices(bundleId) {
  return useSyncExternalStore(store.subscribe, () => store.pick(bundleId), serverSnapshot);
}
