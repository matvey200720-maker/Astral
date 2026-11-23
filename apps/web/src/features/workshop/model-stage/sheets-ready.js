/*
 * Когда кадр готов к снимкам предметов (ТЗ ведущего 26.10.2026: плитки «Контейнер, вид 3» и «вид 5» вставали тёмными).
 *
 * Плитки панели «Предметы» снимаются своим рендером из сцены кадра. Сцена появляется сразу, а листы (текстуры) доезжают позже: лист
 * приходит, материалы получают его на следующем кадре экрана (`sheet-batch.js`), а итоговый проход облика делается после тихой минуты.
 * Снимок, взятый раньше, видит материалы без листов и без итогового облика — тёмную заглушку. Те же пять контейнеров завода, снятые сразу
 * и после, различались по яркости в 1,3—6 раз.
 *
 * Здесь — ожидание по событиям, а не по таймеру: все листы, что просил облик, ответили (пришли или не придут), а пачка листов отыграла.
 * Новые листы, что попросили за время ожидания, тоже ждём. `patience` — только предохранитель на случай, когда Astral Desktop не отвечает
 * вовсе: после него плитки берутся с тем, что есть, а не остаются скелетом навсегда (`false` в ответе).
 *
 * Чистый модуль без three и DOM: его читает `orbit-stage.js`, а тест гоняет на подставных листах.
 */

/** `true` — листы пришли и пачка отыграла; `false` — кадр закрыт или предохранитель сработал. */
export async function waitForSheets({ pending, batch, patience = 30000, alive = () => true, now = () => performance.now() }) {
  const until = now() + patience;
  /* Ждём событие, но не дольше предохранителя; таймер за собой убираем. */
  const within = (promise) => {
    let handle;
    return Promise.race([
      Promise.resolve(promise).then(() => true),
      new Promise((resolve) => {
        handle = setTimeout(() => resolve(false), Math.max(0, until - now()));
      }),
    ]).finally(() => clearTimeout(handle));
  };
  while (alive()) {
    /* Листы, что ещё едут: за время ожидания их могло прибавиться, поэтому список берём заново. */
    const loading = pending();
    if (loading.length) {
      if (!(await within(Promise.all(loading)))) return false;
      continue;
    }
    if (batch.busy) {
      if (!(await within(batch.idle()))) return false;
      continue;
    }
    return true;
  }
  return false;
}

/**
 * То же, но терпение — не часы, а молчание читателя (находка 1 ревью тестового ПК, 15.11.2026): кусок настоящей карты в «Зонах» показывается, когда листы приехали, и прежние 6 с на всё ожидание
 * (`texturesSettled`) отпускали холодное место посреди загрузки — город вставал в среднем цвете. Здесь ждём, пока листы отвечают: ответ любого листа молчание считает заново, а тишина дольше
 * `silenceMs` (ни один лист не ответил) — предохранитель на случай, когда читатель завис. `true` — листы ответили и пачка отыграла; `false` — тишина или кадр закрыт.
 * События, не опрос: каждый шаг ждёт ближайший ответ листа (или конец пачки) и тишину.
 */
export async function waitForSheetsQuiet({ pending, batch, silenceMs = 60000, alive = () => true }) {
  while (alive()) {
    const loading = pending();
    const next = loading.length ? Promise.race(loading) : batch.busy ? batch.idle() : null;
    if (!next) return true;
    let handle;
    const answered = await Promise.race([
      Promise.resolve(next).then(() => true),
      new Promise((resolve) => {
        handle = setTimeout(() => resolve(false), silenceMs);
      }),
    ]).finally(() => clearTimeout(handle));
    if (!answered) return false;
  }
  return false;
}
