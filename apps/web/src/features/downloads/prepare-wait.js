import { useSyncExternalStore } from "react";

/*
 * Установка ждёт, пока готовится игра (T-0001, 22.11.2026). Первая установка после «Вернуть GTA V без модов» сначала снимает удержание штатной игры:
 * подготовка пересобирает `update.rpf` до двух минут, и строки очереди за это время нет — «Загрузки» были пустыми, человек не знал, что установка идёт.
 * Пока подготовка идёт, здесь живёт запись «ждёт игру»: «Загрузки» рисуют по ней героя (`ribbon/PrepareWaitHero.jsx`). В очередь она не ложится:
 * очередь запускает первую живую строку, а запись — только слово для человека.
 */

const waits = { list: [], watchers: new Set() };

function watch(listener) {
  waits.watchers.add(listener);
  return () => {
    waits.watchers.delete(listener);
  };
}

const emit = () => {
  for (const listener of [...waits.watchers]) listener();
};

export const installWaitsNow = () => waits.list;

/*
 * Срок записи. Подготовка идёт до двух минут; не кончилась за `WAIT_LIMIT_MS` — запись показа снимается сама, чтобы строка «игра готовится» не залипла
 * (подготовка при этом идёт дальше, установка начнётся, когда она кончится). Между концом подготовки и строкой очереди идёт план установки — запись
 * держится ещё `PLAN_GRACE_MS` (фаза `planning`), пустой страницы между ними нет. Это одноразовые таймеры на запись, а не опрос.
 */
export const WAIT_LIMIT_MS = 5 * 60_000;
export const PLAN_GRACE_MS = 6_000;

function arm(wait, ms) {
  clearTimeout(wait.timer);
  wait.timer = setTimeout(() => endInstallWait(wait), ms);
}

/** Начать ожидание мода `mod` (`{ id, name, … }`); повторное ожидание того же мода заменяет прежнее, дубля нет. */
export function beginInstallWait(mod) {
  const wait = { key: `prepare-wait-${mod?.id ?? ""}`, mod, phase: "preparing", timer: 0 };
  for (const item of waits.list) if (item.key === wait.key) clearTimeout(item.timer);
  waits.list = [...waits.list.filter((item) => item.key !== wait.key), wait];
  arm(wait, WAIT_LIMIT_MS);
  emit();
  return wait;
}

/** Подготовка кончилась: запись остаётся ещё ненадолго (план установки), потом уходит сама или когда в очереди появилась строка мода. */
export function settleInstallWait(wait) {
  if (!waits.list.includes(wait)) return;
  wait.phase = "planning";
  arm(wait, PLAN_GRACE_MS);
  waits.list = [...waits.list];
  emit();
}

/** Снять ожидание (подготовка отказала или срок вышел). Чужое и уже снятое не трогает. */
export function endInstallWait(wait) {
  if (!waits.list.includes(wait)) return;
  clearTimeout(wait.timer);
  waits.list = waits.list.filter((item) => item !== wait);
  emit();
}

/** Для тестов: снять все записи и их таймеры. */
export function resetInstallWaits() {
  for (const item of waits.list) clearTimeout(item.timer);
  waits.list = [];
  emit();
}

export const isWaitingToInstall = (id) => waits.list.some((item) => item.mod?.id === id);

export function useInstallWaits() {
  return useSyncExternalStore(watch, installWaitsNow, installWaitsNow);
}
