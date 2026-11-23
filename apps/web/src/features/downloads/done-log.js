import { useSyncExternalStore } from "react";
import { modPicture } from "../library/mod-picture.js";

/*
 * Что уже поставлено сегодня — для «Загрузок» v2-A «Лента» (15.11.2026).
 *
 * Строка очереди каталога уходит из очереди в ту же секунду, как установка
 * закончилась успешно: следа в окне не оставалось, и «Готово сегодня» с итогом
 * «Всё готово» было не из чего собрать. Теперь оболочка записывает сюда каждую
 * удавшуюся операцию (имя, картинку, раздел, размер, когда встала в очередь и
 * когда закончилась). Записи лежат в `localStorage` — переживают перезапуск
 * окна, показываются за сегодняшний день; не больше KEEP последних. Работы
 * мастерской сюда не пишутся: у них есть свои строки со статусом «Готово».
 */

const KEY = "astral.downloads.done.v1";
const KEEP = 60;

const listeners = new Set();
let records = readStored();

function readStored() {
  try {
    const parsed = JSON.parse(globalThis.localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecord).slice(-KEEP) : [];
  } catch {
    return [];
  }
}

function isRecord(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    Number.isFinite(value.at)
  );
}

function store() {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    // хранилище недоступно: запись живёт, пока открыто окно
  }
}

function publish(next) {
  records = next;
  store();
  for (const listener of listeners) listener();
}

const numberOrZero = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

/** Запись об удавшейся операции очереди каталога; картинка — та же, что у строки очереди (`modPicture`). */
export function recordDownloadDone(
  item,
  picture = modPicture(item),
  at = Date.now(),
) {
  if (!item || item.failed) return;
  const entry = {
    id: String(item.id ?? ""),
    name: String(item.name ?? ""),
    operation:
      item.operation === "remove" || item.operation === "reset"
        ? item.operation
        : "install",
    picture: String(picture || ""),
    categoryLabel: String(item.categoryLabel || ""),
    sizeBytes: numberOrZero(
      item.installPlan?.summary?.writeBytes ??
        item.totalBytes ??
        item.sizeBytes,
    ),
    queuedAt: numberOrZero(item.queuedAt) || numberOrZero(item.startedAt) || at,
    startedAt:
      numberOrZero(item.startedAt) || numberOrZero(item.queuedAt) || at,
    at,
  };
  if (!entry.name) return;
  publish([...records, entry].slice(-KEEP));
}

/** Все записи по возрастанию времени окончания. */
export const readDoneLog = () => records;

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Записи для компонента: перерисовывается, когда появилась новая. */
export function useDoneLog() {
  return useSyncExternalStore(subscribe, readDoneLog, readDoneLog);
}

const sameDay = (a, b) => {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
};

/** Сегодняшние записи, новые первыми. */
export function doneToday(list, now = Date.now()) {
  return list
    .filter((entry) => sameDay(entry.at, now))
    .sort((a, b) => b.at - a.at);
}

/**
 * Последняя непрерывная сессия: записи, между которыми очередь не пустела. Запись входит, если её закончили не раньше,
 * чем встала в очередь самая ранняя из уже вошедших (или из ещё идущих строк, `liveQueuedAts`). Новые первыми.
 */
export function latestBatch(list, liveQueuedAts = []) {
  const sorted = [...list].sort((a, b) => b.at - a.at);
  let edge = liveQueuedAts.length ? Math.min(...liveQueuedAts) : Infinity;
  const batch = [];
  for (const entry of sorted) {
    // Без идущих строк последняя запись входит сама; дальше — пока очередь не пустела.
    const head = batch.length === 0 && edge === Infinity;
    if (!head && entry.at < edge) break;
    batch.push(entry);
    edge = Math.min(edge, entry.queuedAt);
  }
  return batch;
}

/** Для тестов и песочницы: журнал заводится заново. */
export function resetDoneLog(next = []) {
  publish(next.filter(isRecord).slice(-KEEP));
}
