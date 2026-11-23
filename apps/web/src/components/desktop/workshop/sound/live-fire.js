/*
 * Живая очередь: стрельба, которая идёт, пока её не остановили, и звук,
 * который меняется прямо в ней.
 *
 * Очередь не собирается заранее целиком, как раньше (тридцать выстрелов — и
 * тишина): расписание пополняется на ходу, на пятую долю секунды вперёд, и
 * каждый следующий выстрел берёт звук, который стоит в студии сейчас.
 * Двинул ползунок — через выстрел-другой слышно новое, очередь при этом не
 * прерывается. Так же живёт серия попаданий.
 *
 * Здесь две части. Узор — чистые функции: когда жмут курок, сколько держат,
 * когда отпускают и перезаряжают; их проверяют тесты без Web Audio. Ход —
 * `createLiveLoop`: таймер, который по часам контекста раздаёт события узора
 * проигрывателю и сцене.
 */

import { cancelVoice, liveClock } from "./WaveformPlayer.jsx";

/*
 * Магазин отстреливается целиком, если на это уходит не больше четырёх с
 * половиной секунд (у карабина 30 патронов — 4,1 с), иначе курок держат три
 * секунды и отпускают: пулемёт на сто патронов не очередь, а стена.
 */
const MAGAZINE_SECONDS = 4.5;
const BURST_SECONDS = 3;
/* Полуавтомат жмут пальцем, а не держат: чаще этого выстрелы не идут. */
const TRIGGER_PULL_SECONDS = 0.34;
/* Между магазинами — перезарядка, между очередями — отпущенный курок. */
const RELOAD_SECONDS = 1;
const RELEASE_SECONDS = 0.5;
/* Пуля до мишени — столько же, сколько летит в кадре попаданий. */
export const HIT_FLIGHT_SECONDS = 0.12;
/* Серия попаданий: два в тело и одно в голову, с паузой на слух. */
const SERIES_GAP_SECONDS = 0.42;
const SERIES_REST_SECONDS = 0.9;

/**
 * Как стреляет ствол, когда держат курок.
 *
 * @returns {{cadence: number, burst: number, pause: number, auto: boolean}}
 *   секунды между выстрелами, выстрелов до отпускания, пауза до следующей
 *   очереди, автомат ли (у автомата после очереди звучит хвост)
 */
export function firePlan(weapon) {
  const interval = weapon?.rpm ? 60 / weapon.rpm : 0.25;
  const auto = Boolean(weapon?.auto);
  const cadence = auto ? interval : Math.max(interval, TRIGGER_PULL_SECONDS);
  const clip = Math.max(1, Math.round(Number(weapon?.clip)) || 1);
  /* Полуавтомат жмут на каждый выстрел: «очереди» у него нет — весь магазин
     в темпе пальца и перезарядка. Тазер с одним «патроном» перезаряжается
     темпом ствола — сверху не добавляется ничего. */
  if (!auto)
    return { cadence, burst: clip, pause: clip > 1 ? RELOAD_SECONDS : 0, auto };
  const whole = (clip - 1) * cadence <= MAGAZINE_SECONDS;
  const burst = whole
    ? clip
    : Math.max(1, Math.min(clip, Math.floor(BURST_SECONDS / cadence) + 1));
  const pause = whole ? RELOAD_SECONDS : RELEASE_SECONDS;
  return { cadence, burst, pause, auto };
}

/** Начало стрельбы: первый выстрел — в `at` (секунды часов контекста). */
export const fireState = (at) => ({ cursor: at, index: 0, lastShot: null });

/**
 * События очереди до `until`: `first` (первый выстрел очереди), `shot`,
 * `tail` (хвост, когда курок отпущен). `state` сдвигается — следующий вызов
 * продолжает с того же места. План берётся на каждом шаге заново: сменили
 * ствол посреди очереди — следующий выстрел уже в его темпе.
 *
 * @param {{cursor: number, index: number, lastShot: number|null}} state
 * @param {() => ReturnType<typeof firePlan>} planOf
 * @param {number} until
 * @param {{shotSeconds?: number, hasTail?: boolean}} [sound]
 */
export function nextFireEvents(state, planOf, until, sound = {}) {
  const events = [];
  for (let guard = 0; guard < 256 && state.cursor < until; guard += 1) {
    const plan = planOf();
    if (state.index < plan.burst) {
      events.push({
        kind: state.index === 0 ? "first" : "shot",
        at: state.cursor,
        index: state.index,
      });
      state.lastShot = state.cursor;
      state.index += 1;
      state.cursor += plan.cadence;
      continue;
    }
    /* Курок отпущен: у автомата звучит хвост — там, где кончился бы
       последний выстрел, а не через целый такт. */
    if (plan.auto && sound.hasTail && state.lastShot !== null)
      events.push({
        kind: "tail",
        at:
          state.lastShot +
          Math.min(plan.cadence, sound.shotSeconds || plan.cadence),
      });
    state.index = 0;
    state.cursor += plan.pause;
  }
  return events;
}

/**
 * Узор серии попаданий: два в тело и одно в голову — из тех частей, у
 * которых есть звук. Одна часть — одна она, в том же темпе.
 */
export function seriesPattern(parts) {
  const has = new Set(parts);
  const order = ["body", "body", "head"].filter((part) => has.has(part));
  return order.length ? order : [];
}

export const seriesState = (at) => ({ cursor: at, index: 0 });

/** События серии до `until`: `{part, at}`; `state` сдвигается. */
export function nextSeriesEvents(state, patternOf, until) {
  const events = [];
  for (let guard = 0; guard < 64 && state.cursor < until; guard += 1) {
    const pattern = patternOf();
    if (!pattern.length) break;
    const index = state.index % pattern.length;
    const last = index === pattern.length - 1;
    events.push({ part: pattern[index], at: state.cursor });
    state.index = last ? 0 : index + 1;
    state.cursor += SERIES_GAP_SECONDS + (last ? SERIES_REST_SECONDS : 0);
  }
  return events;
}

/* Сколько вперёд расписано и как часто оно пополняется: запас в треть секунды
   переживает занятый кадр (кадр стрельбища с эффектами игры на слабом ПК —
   70–90 мс, первый выстрел с шейдерами частиц — дольше), а правка слышна через
   три-четыре выстрела. Было 0,2 с: кадр дольше запаса — и выстрелы пропадали
   (ТЗ 24.10.2026, п. 3). */
const LOOKAHEAD_SECONDS = 0.35;
const TICK_MS = 25;
/*
 * Кадр бывает занят дольше запаса: сменили ствол посреди стрельбы — окно
 * разбирает его модель. Выстрел, опоздавший на чуть-чуть, звучит чуть позже;
 * опоздавший дальше этого — пропущен: иначе все пропущенные за паузу
 * выстрелы грянули бы разом, одним громким треском.
 */
const LATE_SECONDS = 0.1;

/**
 * Ход живой очереди.
 *
 * `produce(until)` отдаёт события до `until` (секунды часов контекста),
 * `play(event)` ставит звук события и возвращает его источник, `onEvents`
 * получает события вместе со временем на часах страницы — для сцены.
 * `clock` и `cancel` — часы и снятие звука окна; тесты подставляют свои.
 */
export function createLiveLoop({
  produce,
  play,
  onEvents,
  clock = liveClock,
  cancel = cancelVoice,
}) {
  let timer = 0;
  let running = false;
  const pending = new Set();

  function tick() {
    const time = clock();
    if (!time || !running) return;
    const events = produce(time.now + LOOKAHEAD_SECONDS);
    const shown = [];
    for (const event of events) {
      if (event.at < time.now - LATE_SECONDS) continue;
      const source = play(event);
      if (source) {
        const item = { source, at: event.at };
        pending.add(item);
        source.addEventListener?.("ended", () => pending.delete(item));
      }
      shown.push({ ...event, page: time.toPage(event.at) });
    }
    if (shown.length) onEvents?.(shown);
  }

  return {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      tick();
      timer = globalThis.setInterval(tick, TICK_MS);
    },
    /** Пополнить расписание сейчас — например, когда пришёл первый звук. */
    poke() {
      if (running) tick();
    },
    /**
     * Остановка. Расписанное вперёд снимается: «Стоп» значит тишину сейчас,
     * а не через пятую долю секунды.
     */
    stop() {
      running = false;
      globalThis.clearInterval(timer);
      const now = clock()?.now ?? 0;
      for (const item of [...pending])
        if (item.at > now + 0.004) {
          cancel(item.source);
          pending.delete(item);
        }
    },
  };
}
