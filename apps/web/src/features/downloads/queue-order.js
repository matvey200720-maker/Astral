/*
 * Порядок очереди установок (владелец, 16.11.2026: «порядок меняется перетаскиванием за ручку, куда угодно»).
 *
 * Оболочка запускает первую живую строку очереди (`DesktopShell.jsx`, `current = queue.find(...)`), так что порядок строк в массиве и есть порядок
 * установки. Переставлять можно только ждущие строки: идущая, остановившаяся и поставленные не двигаются, а на их местах массива ничего не меняется.
 */

/** Строку можно переставлять: она живая (не отказ) и ещё не начата. */
export const isReorderable = (row) =>
  Boolean(row) && !row.failed && !row.started;

/**
 * Новый массив очереди: названные в `orderedIds` ждущие строки меняются местами между собой — они ложатся в те же места массива, где стояли, но в новом
 * порядке. Остальные строки не двигаются. Список с повтором, чужой строкой, идущей или остановившейся строкой очередь не меняет: порядок не может потерять
 * или задвоить строку.
 *
 * @param {{ queueId: string, failed?: unknown, started?: boolean }[]} queue очередь оболочки
 * @param {string[]} orderedIds `queueId` ждущих строк в желаемом порядке
 */
export function applyQueueOrder(queue, orderedIds) {
  const wanted = new Set(orderedIds);
  if (wanted.size !== orderedIds.length) return queue;
  const slots = [];
  queue.forEach((row, at) => {
    if (isReorderable(row) && wanted.has(row.queueId)) slots.push(at);
  });
  if (slots.length !== wanted.size) return queue;
  const byId = new Map(slots.map((at) => [queue[at].queueId, queue[at]]));
  const next = queue.slice();
  slots.forEach((at, order) => {
    next[at] = byId.get(orderedIds[order]);
  });
  return next.every((row, at) => row === queue[at]) ? queue : next;
}

/** Список `ids` без `id`, а затем с ним на месте `index` (0 — первым). Индекс за краями зажимается; не стронулся — тот же список. */
export function moveId(ids, id, index) {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const rest = ids.filter((item) => item !== id);
  const at = Math.min(Math.max(index, 0), rest.length);
  if (at === from) return ids;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
