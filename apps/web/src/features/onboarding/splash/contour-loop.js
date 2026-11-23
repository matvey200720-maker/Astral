/*
 * Заставка «Контур»: цикл кадров для потока (17.11.2026). Холст отдан воркеру (`contour-worker.js`), поэтому главный поток,
 * занятый разбором каталога и сборкой оболочки под заставкой, больше не рвёт движение света: на замере в Electron при
 * приходе каталога шли 4–5 кадров по 28–42 мс прямо в добегании, а перед ними — один в 41–70 мс.
 *
 * Здесь только цикл и рисунок, без `self`, `requestAnimationFrame` и DOM: всё это передаёт вызывающий (`schedule`, `cancel`,
 * `post`), поэтому цикл проверяется тестом без потока. Слова, заливки отрезков и слой ухода остаются на главном потоке
 * (`contour-host.js`): воркер присылает им ход (`view`), а они его показывают.
 *
 * Ход запуска приходит сообщениями: сколько этапов закрыто, открылось ли окно, ждёт ли следующий экран, не удался ли запуск.
 * Когда начинается уход, воркер замирает и просит у главного потока место посадки знака (`exit-begin` → `exit`): знак шапки
 * измеряется там, где есть DOM, а кадр ухода сразу рисуется с настоящим местом.
 */

import {
  EXIT_SOFT,
  SOFT_STEP_MS,
  advance,
  createRun,
  framePlan,
  launchDurations,
  layoutOf,
  phaseOf,
  stateOf,
} from "./contour-model.js";
import { drawFrame } from "./contour-draw.js";

/** Шаг времени заставки не больше этого: остановленное окно не должно выбросить свет вперёд, когда оно проснётся. */
export const MAX_STEP_MS = 100;
/** Если главный поток не ответил про место посадки за это время, уход идёт на место по умолчанию. */
export const EXIT_ANSWER_MS = 1000;

const IDLE = Object.freeze({
  closed: 0,
  ready: false,
  hold: false,
  fail: false,
});

/**
 * `canvas` — холст воркера (`OffscreenCanvas`), `post(message)` — сообщение главному потоку, `schedule(cb)` / `cancel(id)` —
 * следующий кадр (в воркере это `requestAnimationFrame`).
 */
export function createLoop({ canvas, post, schedule, cancel }) {
  const ctx = canvas.getContext("2d");
  let run = createRun();
  let geometry = layoutOf(1, 1);
  let input = IDLE;
  let expect;
  let landing = null;
  let frame = 0;
  let last = null;
  let finished = false;
  let painted = false;
  let waitingSince = null;
  let plan = null;

  function resize(width, height, ratio) {
    geometry = layoutOf(width, height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (plan) drawFrame(ctx, plan, geometry);
  }

  function view(at, state, drawn) {
    const message = {
      type: "view",
      t: at,
      L: state.L,
      k: state.k,
      phase: phaseOf(state),
      exit: state.exit,
    };
    if (state.exit > 0) {
      message.plan = {
        mode: drawn.mode,
        textAlpha: drawn.textAlpha,
        veilAlpha: drawn.veilAlpha,
        reveal: drawn.reveal,
      };
    }
    post(message);
  }

  function step(at) {
    frame = 0;
    if (finished) return;
    if (waitingSince !== null) {
      // ждём ответа про место посадки: время заставки стоит
      last = at;
      if (at - waitingSince < EXIT_ANSWER_MS) {
        frame = schedule(step);
        return;
      }
      waitingSince = null;
      landing = { next: undefined, land: undefined };
    }
    // первые кадры ухода: оболочка под заставкой возвращается в них, ждавший кадр не перескакивает уход (`EXIT_SOFT`)
    const limit =
      landing && stateOf(run).exit < EXIT_SOFT ? SOFT_STEP_MS : MAX_STEP_MS;
    const dt = last === null ? 0 : Math.min(Math.max(at - last, 0), limit);
    last = at;
    const before = run;
    run = advance(run, dt, { ...input, expect });
    const state = stateOf(run);
    if (state.exit > 0 && !landing) {
      run = before;
      waitingSince = at;
      post({ type: "exit-begin" });
      frame = schedule(step);
      return;
    }
    plan = framePlan(state, geometry, {
      next: landing?.next,
      land: landing?.land,
    });
    drawFrame(ctx, plan, geometry);
    if (!painted) {
      painted = true;
      post({ type: "first" });
    }
    view(at, state, plan);
    if (state.exit >= 1) {
      finished = true;
      post({ type: "finish", durations: launchDurations(run) });
      return;
    }
    frame = schedule(step);
  }

  return {
    resize,
    /** Ход запуска: любые из `closed`, `ready`, `hold`, `fail`. */
    setInput({
      closed = input.closed,
      ready = input.ready,
      hold = input.hold,
      fail = input.fail,
    } = {}) {
      input = { closed, ready, hold, fail };
    },
    /** Ожидаемые длительности лучей (мс) из памяти запусков. */
    setExpect(next) {
      expect = next;
    },
    /** Место посадки знака и куда уходим: ответ на `exit-begin`. */
    setLanding(next, land) {
      landing = { next, land };
      waitingSince = null;
    },
    start() {
      if (!frame && !finished) frame = schedule(step);
    },
    stop() {
      finished = true;
      if (frame) cancel(frame);
      frame = 0;
    },
  };
}
