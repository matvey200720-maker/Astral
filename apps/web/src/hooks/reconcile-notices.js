/*
 * Что Astral исправил сам, — словами (задача 1 ТЗ 10.10.2026).
 *
 * Сбои вокруг Astral — перенос кэша, игра в другой папке, update.rpf из
 * старой копии, переустановка, почищенный кэш — движок больше не превращает
 * в отказ: он пересчитывает, что в игре на самом деле, и ставит дальше. Его
 * опись событий приходит в профиле окна (`profile.reconcile[targetId]`), а
 * здесь новые события превращаются в одну короткую строку уведомления.
 * Показанное помнится по времени последнего события на цель: перезапуск
 * окна его не повторяет.
 */

import { useCallback, useRef } from "react";
import { rewriteMovedGameRecords } from "../workshop-library.js";

const SEEN_KEY = "astral.reconcile.seen.v1";

/**
 * Обработчик событий отчёта для оболочки: новые события — строкой
 * уведомления (`notify`), переезд игры — ещё и записям установок
 * мастерской. Ссылка на обработчик постоянна: им пользуется
 * `syncInstalledProfile`, который не должен меняться от рендера к рендеру.
 */
export function useReconcileNotices({ language, notify }) {
  const latest = useRef(null);
  latest.current = (events, targetId) => {
    const fresh = takeNewReconcileEvents(events, targetId);
    for (const event of fresh)
      if (event.kind === "game-moved") rewriteMovedGameRecords(event.from, event.to);
    if (!fresh.length) return;
    /* Слова — отдельным куском (`reconcile-words.js`): они нужны только в момент события, а не к первому кадру. Кусок не загрузился — строки нет, показанное уже помечено. */
    import("./reconcile-words.js").then(({ describeReconcileEvents }) => {
      const text = describeReconcileEvents(fresh, language);
      if (text) notify(text);
    }, () => {});
  };
  return useCallback((events, targetId) => latest.current?.(events, targetId), []);
}

function readSeen(storage) {
  try {
    const value = JSON.parse(storage?.getItem(SEEN_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/**
 * События цели, которых окно ещё не показывало, и отметка, что показало.
 * Первое знакомство с целью (отметки нет) показывает события только этого
 * часа: старые сбои давно позади.
 */
export function takeNewReconcileEvents(events, targetId, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  const list = Array.isArray(events) ? events.filter((event) => event?.kind && event?.at) : [];
  if (!targetId || !list.length) return [];
  const seen = readSeen(storage);
  const since = seen[targetId] || new Date(now - 60 * 60 * 1000).toISOString();
  const fresh = list.filter((event) => String(event.at) > since);
  const latest = list.map((event) => String(event.at)).sort().at(-1);
  if (latest && latest !== seen[targetId]) {
    try {
      storage?.setItem(SEEN_KEY, JSON.stringify({ ...seen, [targetId]: latest }));
    } catch {
      /* Хранилище окна недоступно — покажем ещё раз, не страшно. */
    }
  }
  return fresh;
}
