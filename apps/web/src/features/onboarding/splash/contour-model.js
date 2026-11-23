/*
 * Заставка «Контур» (15.11.2026): время и ход запуска → кадр, без холста и без DOM.
 *
 * Свет обводит знак Astral, и каждый из четырёх лучей — настоящий этап запуска (`startup.js`: сессия, поиск GTA V, библиотека,
 * каталог). Макет рисовал ход по сценарию; здесь ход — факт: этап закрылся, и свет идёт к следующему концу. Время внутри этапа,
 * сглаживание хода, росчерк, заливка и уход — как в макете (`.local/design-1511/r8/onboard/splash-core.js`, `splash-v2.js`).
 * Всё здесь — функции от числа миллисекунд, поэтому кадр проверяется тестом без холста (`test/splash-contour.test.js`).
 */

import {
  STAR_BOX,
  STAR_TIPS,
  lengthAtLevel,
  pointAt,
  starPaths,
} from "./star-shape.js";
import { STAGE_COUNT } from "./splash-words.js";
import {
  CHASE,
  FINISH_AIM,
  paceTarget,
  planOf,
  stepPace,
} from "../../pace/pace.js";
import { LAND_DEFAULT } from "./wake-model.js";

export { LAND_DEFAULT, STAGE_COUNT };
/** После «полно» — росчерк, заливка, кольцо; потом уход. */
export const POST_MS = 1400;
export const EXIT_MS = 1600;
/**
 * Первые кадры ухода: оболочка под заставкой возвращается именно в них (первая отрисовка — 60–80 мс на замере в Electron), и
 * кадр, долго её ждавший, не должен перескакивать уход. Пока уход дальше этой доли, время кадра засчитывается не больше
 * `SOFT_STEP_MS`: задержка видна паузой в самом начале ухода, где движения ещё почти нет, а не прыжком.
 */
export const EXIT_SOFT = 0.2;
export const SOFT_STEP_MS = 20;
/** Этап не закрывается дольше — заставка объясняет, что ждёт. */
export const LONG_MS = 8000;
/** Свет начинает ползти к первому лучу не сразу, как в макете. */
export const CREEP_START_MS = 250;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (x) => {
  const t = clamp(x, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
export const easeOut = (x) => 1 - (1 - clamp(x, 0, 1)) ** 3;

/** Размер и место знака в окне: ширина `clamp(min(19 %, 29 %), 180, 290)`, центр на 40,5 % высоты. */
export function layoutOf(width, height) {
  const size = Math.round(
    clamp(Math.min(width * 0.19, height * 0.29), 180, 290),
  );
  return {
    size,
    scale: size / STAR_BOX.w,
    cx: width / 2,
    cy: height * 0.405,
    width,
    height,
  };
}

// ─── ход ───────────────────────────────────────────────────────────────────

/**
 * Ход света внутри своего луча: темп по ожидаемому времени этапа — общий для заставки и карточки загрузки сцены
 * (`features/pace/pace.js`, там и описание). Здесь он только привязан к четырём этапам запуска: ожидание — сглаженные
 * длительности прошлых запусков (`launch-memory.js`), пока их нет — `EXPECT_DEFAULT`; узел луча зажигается с k/4 − 0,004,
 * поэтому до него свет без закрытого этапа не доходит.
 */
export const PLAN = planOf(STAGE_COUNT);
export { CHASE, FINISH_AIM };
/** Ожидаемые длительности четырёх лучей (мс), пока заставка не знает прошлых запусков, и пределы, в которых им верят. */
export const EXPECT_DEFAULT = Object.freeze([500, 800, 600, 1100]);
export const EXPECT_MIN = 300;
export const EXPECT_MAX = 6000;
const LIMITS = Object.freeze({
  defaults: EXPECT_DEFAULT,
  min: EXPECT_MIN,
  max: EXPECT_MAX,
});

/**
 * Куда тянется свет: k закрытых этапов — k четвертей, плюс ползание вперёд за время `sinceMs`, прошедшее с последнего закрытия.
 * `expect` — ожидаемые длительности лучей (мс); без него берутся значения по умолчанию.
 */
export function levelTarget(closed, sinceMs, cap = 1, expect = EXPECT_DEFAULT) {
  return paceTarget(PLAN, closed, sinceMs, { expect, limits: LIMITS, cap });
}

/** Шаг хода: свет и его скорость (доли обводки в секунду). Скорость сглаживается сама, поэтому на закрытии этапа она растёт, а не прыгает. */
export const stepLevel = stepPace;

/** Забег заставки: всё, что помнит заставка между кадрами. Время `T` — миллисекунды от её начала. */
export function createRun() {
  return {
    T: 0,
    L: 0,
    V: 0,
    closed: 0,
    mark: CREEP_START_MS,
    progressAt: 0,
    cross: [0, Infinity, Infinity, Infinity, Infinity],
    /** Когда закрылся k-й этап (мс заставки): по ним считаются длительности для памяти запусков. */
    closedAt: [0, Infinity, Infinity, Infinity, Infinity],
    fullAt: Infinity,
    readyAt: Infinity,
    failAt: Infinity,
  };
}

/**
 * Шаг забега на `dt` мс. Вход: `closed` — сколько этапов закрыто подряд с первого (свет идёт по лучам по порядку), `ready` —
 * окно открылось (всё закрыто), `hold` — уход пока нельзя начинать (следующий экран ещё не готов), `fail` — запуск не удался.
 */
export function advance(run, dt, input) {
  const T = run.T + dt;
  const closed = input.ready
    ? STAGE_COUNT
    : clamp(input.closed, 0, STAGE_COUNT);
  const grew = closed > run.closed;
  const failAt = input.fail && run.failAt === Infinity ? T : run.failAt;
  const cap = failAt === Infinity ? 1 : 0.56;
  const mark = grew ? T : run.mark;
  const { level: L, velocity: V } = stepLevel(
    run.L,
    run.V,
    levelTarget(closed, T - mark, cap, input.expect),
    dt,
  );
  const cross = run.cross.slice();
  for (let k = 1; k <= STAGE_COUNT; k += 1) {
    if (cross[k] === Infinity && L >= k / STAGE_COUNT - 0.004) cross[k] = T;
  }
  const closedAt = run.closedAt.slice();
  for (let k = run.closed + 1; k <= closed; k += 1) closedAt[k] = T;
  return {
    T,
    L,
    V,
    closed: Math.max(run.closed, closed),
    mark,
    progressAt: grew ? T : run.progressAt,
    cross,
    closedAt,
    fullAt: run.fullAt === Infinity && L >= 0.9995 ? T : run.fullAt,
    readyAt:
      input.ready && !input.hold && run.readyAt === Infinity ? T : run.readyAt,
    failAt,
  };
}

/**
 * Длительности четырёх лучей этого запуска (мс) — то, что запоминает `launch-memory.js`. `null`, если запуск не дошёл до конца
 * или не удался: такой запуск ожиданий не меняет.
 */
export function launchDurations(run) {
  const at = run.closedAt.slice(1);
  if (run.failAt !== Infinity || !at.every(Number.isFinite)) return null;
  let before = CREEP_START_MS;
  return at.map((moment) => {
    const span = Math.max(0, moment - before);
    before = Math.max(before, moment);
    return span;
  });
}

/** Когда начинается уход: после росчерка и заливки, но не раньше, чем окно открылось. */
export function exitStart(run) {
  return run.fullAt === Infinity || run.readyAt === Infinity
    ? Infinity
    : Math.max(run.fullAt + POST_MS, run.readyAt);
}

/** Состояние кадра из забега: то, от чего зависят и слова, и рисунок. */
export function stateOf(run) {
  const full = run.L >= 0.9995;
  const exit = clamp((run.T - exitStart(run)) / EXIT_MS, 0, 1);
  const fail = clamp((run.T - run.failAt) / 700, 0, 1);
  let k = 0;
  for (let j = 1; j <= STAGE_COUNT; j += 1)
    if (run.L >= j / STAGE_COUNT - 0.004) k = j;
  return {
    T: run.T,
    L: run.L,
    k,
    full,
    beat: full ? Math.max(0, run.T - run.fullAt) : 0,
    exit,
    fail,
    long: !full && fail === 0 && run.T - run.progressAt > LONG_MS,
    cross: run.cross,
  };
}

/** Что показывают слова: этап (с пометкой «долго»), «готово» или ошибка. */
export function phaseOf(state) {
  if (state.fail > 0) return { kind: "error", index: 0, long: false };
  if (state.full) return { kind: "done", index: STAGE_COUNT - 1, long: false };
  return {
    kind: "stage",
    index: clamp(state.k, 0, STAGE_COUNT - 1),
    long: state.long,
  };
}

/** Заливка отрезков хода: у отрезка i — доля 0…1. */
export const trackFill = (level, index) =>
  clamp(level * STAGE_COUNT - index, 0, 1);

// ─── рисунок ───────────────────────────────────────────────────────────────

/** Полёт знака на место в заголовке: `e` 0…1, `bulge` — изгиб дуги в пикселях. Центр, масштаб относительно знака в окне. */
export function flight(e, bulge, geometry, land = LAND_DEFAULT) {
  const dx = land.x - geometry.cx;
  const dy = land.y - geometry.cy;
  const length = Math.hypot(dx, dy) || 1;
  const bend = bulge * Math.sin(Math.PI * e);
  return {
    x: dx * e + (-dy / length) * bend,
    y: dy * e + (dx / length) * bend,
    s: lerp(1, land.w / geometry.size, e),
  };
}

/** Облако света и кадр входа: радиус «окна», через которое проступает следующий экран. */
export function revealRadius(e, geometry) {
  return smooth(e * 1.04) * Math.hypot(geometry.width, geometry.height) * 0.95;
}

/**
 * Всё, что рисует заставка в кадре, числами. `next` — куда уходим (`login` — вход и выбор игры, `home` — главная). Единицы
 * длины — те же, что у знака (рамка 288 × 263), кроме `fly` и `reveal` — они в пикселях окна.
 */
export function framePlan(state, geometry, options = {}) {
  const { T, L, fail, beat, exit } = state;
  const next = options.next || "login";
  const land = options.land || LAND_DEFAULT;
  const marks = starPaths().marks;
  const length = lengthAtLevel(L, marks);
  const total = marks[4];
  const drawing = L < 1 && fail === 0;
  const dim = 1 - 0.55 * fail;
  const breath = state.long ? 1 + 0.25 * Math.sin(T * 0.0042) : 1;
  const headOn = length > 0.5 && L < 1;
  const [hx, hy] = pointAt(starPaths().body, clamp(length, 0.01, total - 0.01));

  const nodes = [];
  for (let k = 0; k < 4; k += 1) {
    const since = T - state.cross[k + 1];
    if (since < 0 || !Number.isFinite(since)) continue;
    const f = Math.exp(-since / 320);
    nodes.push({
      x: STAR_TIPS[k][0],
      y: STAR_TIPS[k][1],
      f,
      alpha:
        (exit > 0 ? 1 - smooth(exit * 3) : 1) *
        (beat > 0 ? 1 - smooth(beat / 500) : 1),
    });
  }

  const sweepShare = easeInOut(clamp(beat / 380, 0, 1));
  const flood = easeOut(clamp((beat - 300) / 760, 0, 1)) * 230;
  const halo =
    (0.08 +
      0.5 * L ** 3 +
      (beat > 0 ? 0.5 * Math.exp(-((beat - 700) ** 2) / 160000) : 0)) *
    (1 - 0.85 * fail);
  const ringShare =
    beat > 700 && beat < 1500 ? easeOut((beat - 700) / 800) : -1;

  const plan = {
    length,
    tail: Math.min(length, 90),
    drawing,
    dim,
    head: headOn
      ? {
          x: hx,
          y: hy,
          r: fail > 0 ? 4.5 : 3.6 * breath,
          glow: fail > 0 ? 14 : 24 * breath,
          alpha: fail > 0 ? 0.7 * (1 - fail * 0.4) : 1,
          glowAlpha: (1 - fail) * 0.9,
          ringed: fail > 0,
        }
      : null,
    nodes,
    sweep: { share: sweepShare, on: L >= 1 },
    flood,
    halo,
    ring:
      ringShare >= 0
        ? { r: 130 + ringShare * 280, alpha: (1 - ringShare) * 0.6 }
        : null,
    // уход
    exit,
    mode: next,
    starAlpha: 1,
    haloAlpha: halo,
    fly: null,
    scale: 1,
    bloom: null,
    small: null,
    reveal: 0,
    veilAlpha: 1,
    textAlpha: 1 - smooth(exit * 3.2),
  };
  if (exit <= 0) return plan;
  if (next === "home") {
    plan.fly = flight(easeInOut((exit - 0.04) / 0.96), -70, geometry, land);
    plan.haloAlpha = halo * (1 - smooth(exit * 2.4));
    plan.veilAlpha = 1 - smooth((exit - 0.28) / 0.5);
    return plan;
  }
  plan.reveal = revealRadius(exit, geometry);
  plan.bloom = {
    alpha: Math.sin(Math.min(1, exit * 1.6) * Math.PI) * 0.8,
    scale: 0.6 + easeOut(exit) * 2.6,
  };
  plan.starAlpha = 1 - smooth((exit - 0.1) / 0.5);
  plan.scale = 1 + 0.22 * easeOut(exit * 1.3);
  plan.small = {
    alpha: smooth((exit - 0.55) / 0.35),
    scale: 0.6 + 0.4 * easeOut((exit - 0.55) / 0.45),
    x: land.x,
    y: land.y,
    w: land.w,
  };
  return plan;
}

/** Спокойная версия (`prefers-reduced-motion`, «меньше движения»): знак проявляется яркостью, без движения. */
export function calmPlan(state) {
  const { L, exit } = state;
  return {
    lit: 0.1 + 0.9 * L,
    starAlpha: exit > 0 ? 1 - smooth(exit * 1.6) : 1,
    veilAlpha: 1 - smooth((exit - 0.2) / 0.8),
    textAlpha: 1 - smooth(exit * 3.2),
  };
}
