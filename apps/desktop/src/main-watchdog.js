/*
 * Сторож главного потока (ТЗ 06.10.2026, вечер, задача 1).
 *
 * «Лаунчер вылетает при „Применить“» в журнале Windows выглядел как
 * `AppHangB1` у `electron.exe`: главный поток не отвечал окну, и система его
 * закрыла. Журнал Astral при этом молчал — замирание некому было заметить:
 * пока поток стоит, не идёт и никакой код. Сторож замечает его по факту —
 * по опоздавшему таймеру — и пишет в журнал, сколько поток стоял и какие
 * каналы окна были в работе. По такой записи видно, кого переносить из
 * главного потока, без догадок.
 *
 * Таймер живёт, только пока есть работа: идёт обработчик канала окна или
 * взята «задержка» (запуск, операция мастерской). В простое главный процесс
 * не просыпается ради сторожа — свёрнутый Astral не тратит на него ничего.
 */

import { performance } from "node:perf_hooks";
import { appLog } from "./app-log.js";

const seconds = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} с`;

export function createMainWatchdog({
  log = appLog,
  intervalMs = 250,
  stallMs = 2000,
  now = () => performance.now(),
  timers = { setInterval, clearInterval },
} = {}) {
  const inFlight = new Map();
  let nextId = 1;
  let holds = 0;
  let timer = null;
  let last = 0;
  let worst = 0;
  /* Поток-наблюдатель (`main-stall-sampler.js`): снимает стек, пока поток стоит. */
  let sampler = null;
  /* Отчёт команде о замирании (20.10): строка в журнале человека видна,
     только если он сам пришлёт журнал. */
  let stallReport = null;

  function disarmIfIdle() {
    if (timer && !inFlight.size && !holds) {
      timers.clearInterval(timer);
      timer = null;
      sampler?.disarm();
    }
  }

  function tick() {
    sampler?.beat();
    const at = now();
    const lag = at - last - intervalMs;
    last = at;
    if (lag >= stallMs) {
      worst = Math.max(worst, lag);
      const channels = [...new Set([...inFlight.values()].map((item) => item.channel))];
      log.record({
        level: "warn",
        source: "main",
        message: `Главный процесс не отвечал ${seconds(lag)}; в работе: ${channels.join(", ") || "фоновые задачи"}`,
      });
      try {
        stallReport?.({ ms: lag, channels });
      } catch {
        /* Отчёт — дополнение к журналу: его сбой сторожа не останавливает. */
      }
    }
    disarmIfIdle();
  }

  function arm() {
    if (timer) return;
    last = now();
    timer = timers.setInterval(tick, intervalMs);
    timer?.unref?.();
    sampler?.arm();
  }

  return {
    /** Обработчик канала окна начал работу; вернувшаяся функция — конец. */
    begin(channel) {
      const id = nextId++;
      inFlight.set(id, { channel: String(channel).replace(/^[a-z]+:/i, ""), at: now() });
      arm();
      return () => {
        inFlight.delete(id);
      };
    },
    /** Держать сторожа включённым (запуск, операция); вернувшаяся функция — отпустить. */
    hold() {
      holds += 1;
      arm();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
      };
    },
    /** Наблюдатель за местом замирания; взведётся вместе со сторожем. */
    attachSampler(next) {
      sampler = next || null;
      if (timer) sampler?.arm();
    },
    /** Куда сообщать о замирании: `({ ms, channels })`. */
    attachStallReport(next) {
      stallReport = typeof next === "function" ? next : null;
    },
    /** Каналы окна, которые сейчас в работе (без повторов): для журнала зонда и отчёта о замирании. */
    channels: () => [...new Set([...inFlight.values()].map((item) => item.channel))],
    /** Для тестов и замеров. */
    state: () => ({ armed: Boolean(timer), inFlight: inFlight.size, holds, worstMs: Math.round(worst) }),
  };
}

export const mainWatchdog = createMainWatchdog();

/** Обёртка обработчика: сторож знает, какой канал в работе. */
export function watchHandler(channel, handler, watchdog = mainWatchdog) {
  return (...args) => {
    const done = watchdog.begin(channel);
    let result;
    try {
      result = handler(...args);
    } catch (error) {
      done();
      throw error;
    }
    if (result && typeof result.then === "function") return result.finally(done);
    done();
    return result;
  };
}
