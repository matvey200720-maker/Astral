/*
 * Листы живой сцены после окончательного отказа читателя (опыт `sheet-retry`, 18.11.2026; `orbit-stage.js`).
 *
 * Читатель не отдал лист: все попытки пачки отклонены (`READER_RETRIES`, паузы 250 и 500 мс в `scene-textures.js: sendBatch`) или игры нет (`unavailable`). Лист объявляется «отвеченным», заставка уходит, сцена остаётся
 * в среднем цвете — и стоит так до ухода с неё: заново лист просится только из `textureFor` при следующем `setLook`, не раньше `READER_COOLDOWN_MS` (10 с), а стенд после «готово» `setLook` не зовёт (стенд «Арен», 18.11:
 * 27 из 27 просьб отклонены, кадр без текстур до конца запуска). С опытом кадр сам перезапрашивает такие листы по таймеру, не больше трёх раундов за сцену; приехавшие встают тем же путём, что и при обычной загрузке
 * (`landSheet` → пачка листов → итог). После трёх раундов — как без опыта.
 *
 * Паузы между раундами — 4, 10 и 30 с (от конца прошлого раунда): 4 с — меньше нельзя, пока игра «не найдена» (`GAME_RETRY_MS` = 4000 в `scene-textures.js`: поиск папки игры заново не раньше), 10 с — прежняя пауза
 * после отказа читателя (`READER_COOLDOWN_MS`), 30 с — масштаб повторного входа в редактор; всего около 45 с на сцену, потом листов не просим: упавший читатель не должен получать просьбы до конца окна.
 *
 * Чистый модуль без three и DOM: «лист» — любой объект; что считать ещё без картинки и как просить заново, подают `pending` и `ask`, часы — `schedule` и `cancel` (тест двигает время без ожидания).
 */

export const SHEET_RETRY_DELAYS_MS = Object.freeze([4000, 10000, 30000]);

/**
 * `pending()` — листы живой сцены, что остались без картинки после окончательного отказа; `ask(листы)` — просит их заново и возвращает (обещанием) сколько приехало;
 * `mark(раунд, просили, приехало, осталось)` — метка для замера (только с журналом меток). Возвращает `{ note, reset, stop, round }`.
 */
export function createSheetRetry({ pending, ask, mark = () => {}, schedule = setTimeout, cancel = clearTimeout, delays = SHEET_RETRY_DELAYS_MS }) {
  let round = 0;
  let timer = 0;
  let generation = 0;
  let alive = true;
  let running = false;

  /* Лист ответил без картинки: заводит таймер следующего раунда (один на сцену; без отказавших листов или после последнего раунда — ничего). */
  function note() {
    if (!alive || timer || running || round >= delays.length) return;
    if (pending().length === 0) return;
    timer = schedule(run, delays[round]);
  }

  async function run() {
    timer = 0;
    if (!alive) return;
    const sheets = pending();
    if (sheets.length === 0) return;
    const mine = generation;
    running = true;
    round += 1;
    const current = round;
    let arrived = 0;
    try {
      arrived = Number(await ask(sheets)) || 0;
    } catch {
      arrived = 0;
    }
    if (mine === generation) running = false;
    if (!alive || mine !== generation) return;
    mark(current, sheets.length, arrived, pending().length);
    note();
  }

  return {
    note,
    /** Сцена сменилась: раунды заново, таймер снят (листы новой сцены просятся сами через `note`). */
    reset() {
      generation += 1;
      round = 0;
      running = false;
      cancel(timer);
      timer = 0;
    },
    /** Кадр закрыт: больше ни таймеров, ни просьб. */
    stop() {
      alive = false;
      cancel(timer);
      timer = 0;
    },
    get round() {
      return round;
    },
  };
}
