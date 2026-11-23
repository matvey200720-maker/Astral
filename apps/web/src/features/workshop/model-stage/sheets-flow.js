/*
 * Путь листа от прихода до итога на экране: пачка за кадр (`sheet-batch.js`) → облик материалов → итог (тени и программы, `sheet-finish.js`) → отрисовка.
 *
 * Итог подводится, как только ждать нечего (14.11.2026, ревью этапа 1): все запрошенные листы ответили (`answered()`), а пришедшие уже отданы
 * обработчику — тогда сразу полный проход облика, сборка программ и тень, без тихой минуты (`SHEET_QUIET_MS` — запасной путь, когда листы ещё
 * едут и неизвестно, будет ли ещё пачка). Лист, что не пришёл (нет в игре, отказ), пачки не рождает — тот же итог по его ответу (`noteAnswered()`).
 * До отрисовки после итога `flushing` истинно: заставка не уходит раньше, чем сцена станет итоговой, — иначе полный проход облика, сборка программ
 * (`warming` держит отрисовку) и перескок тени шли бы уже на виду.
 *
 * Чистый модуль без three и DOM: его собирает `orbit-stage.js`, а тест гоняет на подставных часах.
 */

import { createSheetBatch } from "./sheet-batch.js";
import { SHEET_QUIET_MS, createSheetFinish } from "./sheet-finish.js";

/**
 * `look(only)` — поставить облик (`only` — материалы пришедших листов, `null` — все); `finish()` — собрать программы и перерисовать тени;
 * `answered()` — все запрошенные листы ответили; `held()` — есть материалы, что ждут показа до итога (`reveal-queue.js`): итог нужен и когда листы
 * не пришли; `onFlush(only)` — счётчик (необязателен). Остальное — часы и таймеры для теста.
 */
export function createSheetsFlow({ alive = () => true, look, finish, answered, held = null, onFlush = null, now, timers, schedule, timer, clear }) {
  const sheetFinish = createSheetFinish({ finish, now, timers });
  /* С прошлого полного прохода были частичные: итог требует одного полного, чтобы результат не зависел от очерёдности прихода. */
  let partial = false;
  /* Облик, поставленный изнутри итога, сам может попросить итог (материал ждёт показа) — второй раз внутрь не входим. */
  let concluding = false;
  function conclude(why) {
    if (concluding) return;
    concluding = true;
    try {
      if (partial) look(null);
      partial = false;
      sheetFinish.settle(why);
    } finally {
      concluding = false;
    }
  }
  const batch = createSheetBatch({
    alive,
    settleMs: SHEET_QUIET_MS,
    schedule,
    timer,
    clear,
    onFlush: ({ only }) => {
      onFlush?.(only);
      look(only);
      /* Частичная пачка делает облик неполным до итогового прохода; полная уже обошла всё. */
      partial = only ? true : false;
      /* Ждать нечего — итог сразу, пачке тихая минута не нужна. */
      const final = answered();
      sheetFinish.flush({ full: !only, final });
      if (!final) return false;
      conclude("answered");
      return true;
    },
    /* Листы перестали приходить: запасной путь — тот же итог. */
    onSettle: () => conclude("idle"),
  });
  return {
    batch,
    finish: sheetFinish,
    /** Лист ответил, не прислав картинки: если итог ждал только его — подвести сразу; ждущие показа материалы без итога не встанут. */
    noteAnswered() {
      if (!answered()) return;
      if (batch.settleNow()) return;
      if (held?.() && !batch.flushing) conclude("held");
    },
    /** Кадр нарисован (после итога — итоговый). */
    painted: () => sheetFinish.painted(),
    /** Пришедшие листы ещё не легли на кадр: ждут обработчика, тишины или отрисовки итога. */
    get flushing() {
      return batch.busy || sheetFinish.pending;
    },
  };
}
