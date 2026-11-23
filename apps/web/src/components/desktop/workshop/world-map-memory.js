// Память редактора большой карты: инструмент в руке, раскрытые строки, кадр
// карты и прочее, что не является правкой. Лежит в localStorage по проекту,
// пишется с задержкой и дописывается при закрытии окна.
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "astral.worldMap.memory.v1";
const LIMITS = Object.freeze({ projects: 40, delayMs: 250 });
const CLOSE_EVENTS = Object.freeze(["pagehide", "beforeunload"]);

// Всё состояние модуля в одной записи: дерево памяти ({ проект: { at, values } }),
// последняя известная строка хранилища, таймер записи и признак подписки на закрытие.
const disk = { tree: null, text: null, timer: null, hooked: false };

const attempt = (job, otherwise = undefined) => {
  try {
    return job();
  } catch {
    return otherwise;
  }
};

const textOnDisk = () => attempt(() => globalThis.localStorage.getItem(STORAGE_KEY), null);

const treeFrom = (text) => {
  const parsed = attempt(() => JSON.parse(text), null);
  return Object(parsed) === parsed && !Array.isArray(parsed) ? parsed : {};
};

// Строка в хранилище читается каждый раз: если она другая, дерево разбирается заново.
const liveTree = () => {
  const text = textOnDisk();
  if (disk.tree === null || text !== disk.text) Object.assign(disk, { tree: treeFrom(text), text });
  return disk.tree;
};

const stopTimer = () => {
  const pending = disk.timer;
  disk.timer = null;
  if (pending !== null) globalThis.clearTimeout(pending);
};

const byFreshness = ([, left], [, right]) => (right.at || 0) - (left.at || 0);

const freshestProjects = (tree) =>
  Object.fromEntries(
    Object.entries(tree)
      .filter(([, entry]) => Object(entry) === entry)
      .sort(byFreshness)
      .slice(0, LIMITS.projects),
  );

const flushMapMemory = () => {
  stopTimer();
  if (disk.tree === null) return;
  disk.tree = freshestProjects(disk.tree);
  const storage = attempt(() => globalThis.localStorage, null);
  if (!storage) {
    // Хранилища нет (недоступно, не определено или null): в памяти ничего не остаётся,
    // чтение отдаёт запасное значение.
    disk.tree = null;
    return;
  }
  // переполнение или запрет: дерево остаётся, следующая запись попробует снова
  attempt(() => {
    const text = JSON.stringify(disk.tree);
    storage.setItem(STORAGE_KEY, text);
    disk.text = text;
  });
};

const scheduleSave = () => {
  const needsHook = !disk.hooked && typeof globalThis.addEventListener === "function";
  if (needsHook) {
    disk.hooked = true;
    CLOSE_EVENTS.forEach((name) => globalThis.addEventListener(name, flushMapMemory));
  }
  disk.timer ??= globalThis.setTimeout(flushMapMemory, LIMITS.delayMs);
};

const savedValue = (projectId, key) =>
  projectId ? liveTree()[projectId]?.values?.[key] : undefined;

const readMapMemory = (projectId, key, fallback) => {
  const found = savedValue(projectId, key);
  return found === undefined ? fallback : found;
};

const withKey = (values, key, value) => {
  const copy = { ...values };
  if (value === undefined) delete copy[key];
  else copy[key] = value;
  return copy;
};

const writeMapMemory = (projectId, key, value) => {
  if (!projectId) return;
  const tree = liveTree();
  tree[projectId] = { at: Date.now(), values: withKey(tree[projectId]?.values, key, value) };
  scheduleSave();
};

const forgetMapMemory = (projectId = "") => {
  if (!projectId) disk.tree = {};
  else delete liveTree()[projectId];
  flushMapMemory();
};

// Значение для проекта и ключа: запасное, исправленное записанное или записанное как есть.
const startingValue = (projectId, key, fallback, restore) => {
  const initial = typeof fallback === "function" ? fallback() : fallback;
  const stored = readMapMemory(projectId, key, undefined);
  if (stored === undefined) return initial;
  const result = restore ? restore(stored, initial) : stored;
  return result === undefined ? initial : result;
};

const useMapMemory = (projectId, key, fallback, restore = null) => {
  const scope = `${projectId}|${key}`;
  const [slot, setSlot] = useState(() => ({
    scope,
    value: startingValue(projectId, key, fallback, restore),
  }));

  // Смена проекта или ключа: значение пересчитывается в той же отрисовке.
  let current = slot;
  if (slot.scope !== scope) {
    current = { scope, value: startingValue(projectId, key, fallback, restore) };
    setSlot(current);
  }
  const { value } = current;

  useEffect(() => {
    writeMapMemory(projectId, key, value);
  }, [projectId, key, value]);

  const set = useCallback(
    (next) =>
      setSlot((prev) => {
        const nextValue = typeof next === "function" ? next(prev.value) : next;
        return Object.is(nextValue, prev.value) ? prev : { scope: prev.scope, value: nextValue };
      }),
    [],
  );
  return [value, set];
};

export {
  STORAGE_KEY as MAP_MEMORY_KEY,
  flushMapMemory,
  forgetMapMemory,
  readMapMemory,
  useMapMemory,
  writeMapMemory,
};
