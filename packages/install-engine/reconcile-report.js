/*
 * Что Astral исправил сам, — словами для окна (задача 1 ТЗ 10.10.2026).
 *
 * Сбои вокруг Astral (перенос кэша, игра в другой папке, update.rpf из
 * старой копии, переустановка, проверка файлов) движок больше не превращает
 * в отказ: он пересчитывает, что в игре на самом деле, и ставит дальше. Но
 * человек должен знать, что произошло и что Astral сделал, — иначе пропавший
 * после проверки файлов мод выглядел бы как поломка. Здесь цель копит
 * короткую опись таких событий (`target.reconcile.events`), окно показывает
 * новые один раз (по `at`).
 *
 * Виды событий (`kind`):
 *   • `paths-moved` — хранилище переехало, пути состояния переписаны;
 *   • `base-readopted` — копия архива пропала, основой стала игра;
 *   • `astral-traces-removed` — в архиве нашлись контейнеры или DLC Astral,
 *     которых состояние не знает, они убраны (`containers`, `dlcs`);
 *   • `game-moved` — игра в другой папке, цель переехала (`from`, `to`);
 *   • `mods-lost` — у модов пропали файлы в кэше, они сняты (`modIds`);
 *   • `restored-by-launcher` — проверка файлов или лаунчер вернули архив,
 *     моды сняты и ждут «Установить снова» (`modIds`, задача 2).
 */

const MAX_EVENTS = 24;

/** Добавляет событие в опись цели; одинаковое подряд не дублируется. */
export function noteReconcile(target, event) {
  if (!target || !event?.kind) return null;
  const at = new Date().toISOString();
  const record = { ...event, at };
  const report = target.reconcile && typeof target.reconcile === "object" ? target.reconcile : { events: [] };
  const events = Array.isArray(report.events) ? report.events : [];
  const last = events.at(-1);
  const same =
    last &&
    last.kind === record.kind &&
    JSON.stringify({ ...last, at: null }) === JSON.stringify({ ...record, at: null });
  target.reconcile = {
    at,
    events: same ? [...events.slice(0, -1), record] : [...events, record].slice(-MAX_EVENTS),
  };
  return record;
}

/** События цели новее `since` (ISO), для ответа подготовки и установки. */
export function reconcileEventsSince(target, since = null) {
  const events = Array.isArray(target?.reconcile?.events) ? target.reconcile.events : [];
  if (!since) return events;
  return events.filter((event) => String(event.at || "") > String(since));
}
