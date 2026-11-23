/*
 * Когда листам «подводить итог» (тени и сборка программ) — раз, когда они доехали, а не на каждую пачку.
 *
 * Листы сцены приходят пачками за кадр (`sheet-batch.js`). На каждую пачку кадр заново собирал программы всей сцены (`warm()`: обход всех
 * материалов, а пока он идёт, отрисовка стоит) и просил перерисовать карту теней (`shadowMap.needsUpdate` — полный проход сцены от солнца):
 * «Завод» отдаёт 451 лист, зона — тысячи, и это сотни проходов подряд, пока заставка закрывает кадр и никто их не видит (14.11.2026).
 * Тени и программы нужны один раз, когда листы перестали приходить (`onSettle` пачки) — после последнего листа, чтобы тень от вырезной
 * текстуры (прозрачность по альфе листа) легла по настоящей картинке.
 *
 * Если листы идут без передышки дольше `STREAM_MS`, а кадр уже показан (заставка ушла по потолку ожидания), раз в `STREAM_MS` итог подводится и
 * посреди потока: тень не отстаёт от листов на всё время ожидания. Один лист, пришедший позже всех, посреди потока не считается — он получит
 * итог только после тишины. Явный снимок кадра (`stage.render`) не ждёт тишины: `take()` говорит, что тень устарела, и снимок перерисует её сам.
 *
 * Чистый модуль без three и DOM: его читает `orbit-stage.js`, а тест гоняет на подставных часах.
 */

/** Как часто итог подводится посреди долгого потока листов, мс. */
export const STREAM_MS = 2000;
/** Сколько листы молчат, прежде чем поток считается кончившимся, мс (тихая минута пачки, `sheet-batch.js`). */
export const SHEET_QUIET_MS = 160;

const clockNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Сколько пачек листов идут подряд: `flush()` — пришла пачка, `true` — итог пора подвести, не дожидаясь тишины (поток идёт дольше
 * `every`); `settle()` — листы перестали приходить, итог подведён.
 */
export function createFinishGate({ every = STREAM_MS, now = clockNow } = {}) {
  /* Начало текущего потока (`null` — потока нет) и последний итог, подведённый посреди него. */
  let since = null;
  let last = -Infinity;
  return {
    flush() {
      const at = now();
      if (since === null) since = at;
      if (at - Math.max(since, last) < every) return false;
      last = at;
      return true;
    },
    settle() {
      since = null;
      last = -Infinity;
    },
    /** Идёт ли поток: пачки были, а тишины ещё нет. */
    get streaming() {
      return since !== null;
    },
  };
}

/**
 * Итог листов кадра: `finish()` — собрать программы и перерисовать тени; зовётся
 *  • по тишине пачки (`settle()`, её даёт `sheet-batch.js: onSettle`) — один раз после последнего листа;
 *  • по тишине после полного прохода (`flush({ full: true })`): у пачки после него своей тихой минуты нет, и итог ждёт `quiet` мс без новых пачек;
 *  • посреди долгого потока — не чаще раза в `every` мс.
 * `take()` — снять пометку «тень устарела» (явный снимок перерисует её сам); `forget()` — сцена ушла, пометка и таймер не нужны.
 * `pending` — итог ещё не лёг на экран: либо ещё предстоит (`stale`), либо подведён, но после него кадр ни разу не нарисован (`unpainted`; отрисовку отмечает
 * `painted()`). Заставка не уходит, пока `pending`: сцена открывается уже с итоговой тенью и собранными программами, а не дорисовывается на виду.
 */
export function createSheetFinish({ finish, every = STREAM_MS, quiet = SHEET_QUIET_MS, now = clockNow, timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle) } } = {}) {
  const gate = createFinishGate({ every, now });
  let stale = false;
  let unpainted = false;
  let timer = null;
  const dropTimer = () => {
    if (timer === null) return;
    timers.clear(timer);
    timer = null;
  };
  /* `why` — почему итог подведён (метка `finish` в журнале `marks`): `stream` — посреди долгого потока, `quiet` — тишина после полного прохода, `settle` — листы перестали приходить или все ответили. */
  const run = (why) => {
    stale = false;
    unpainted = true;
    finish?.(why);
  };
  return {
    /** `final` — сразу за пачкой идёт итог (`settle()`): ни посреди потока, ни по тишине итог отдельно не подводится. */
    flush({ full = false, final = false } = {}) {
      stale = true;
      const due = gate.flush();
      if (final) return;
      if (due) run("stream");
      if (!full) return;
      dropTimer();
      timer = timers.set(() => {
        timer = null;
        run("quiet");
        gate.settle();
      }, quiet);
    },
    settle(why = "settle") {
      dropTimer();
      run(why);
      gate.settle();
    },
    take() {
      const was = stale;
      stale = false;
      return was;
    },
    forget() {
      dropTimer();
      stale = false;
      unpainted = false;
      gate.settle();
    },
    /** Кадр нарисован: после итога на экране уже итоговая картинка. */
    painted() {
      unpainted = false;
    },
    get stale() {
      return stale;
    },
    get pending() {
      return stale || unpainted;
    },
    /** Итог подведён, а кадр после него не нарисован: закрытый заставкой кадр рисует именно этот (`cover-gate.js`). */
    get unpainted() {
      return unpainted;
    },
    get streaming() {
      return gate.streaming;
    },
  };
}
