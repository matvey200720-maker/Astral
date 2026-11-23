import { cadenceDrawn, cadenceDue, newCadence, strideFor, vsyncOf } from "../../../../features/workshop/engine/frame-cadence.js";

/* `STAGE_IDLE` из `stage-loop.js` (кадр только по просьбе): своя копия, чтобы темп грузился без окна и ворот внимания — стенд `anim-cadence.mjs --wear` зовёт его в node; равенство держит `character-pose.test.js`. */
const STAGE_IDLE = Number.POSITIVE_INFINITY;

/*
 * Темп живого персонажа (мастерская одежды, ТЗ 31.10.2026). Быстрый — 60 кадров в секунду: развёртка на каждый кадр экрана, а кадр рисуется не раньше `FAST_STEP_MS` после прошлого (на экране 144 Гц — каждая вторая
 * развёртка, на 60 Гц — каждая). Замер в живом Electron на закрытой сборке (`docs/3D.md`, правило 38): интервал кадров ровный (p95 18 мс), отклик студии на щелчок не меняется, цена — 3,7 % главного потока при ×1
 * и 18 % при ×4 против 1,85 % и 2,9 % у тридцати кадров. Медленная машина — кадры дольше `LITE_GAP_MS` в среднем — переходит на 30 кадров в секунду таймером (`CHARACTER_STEP_MS`) насовсем, до следующей модели:
 * живое движение — доли градуса за кадр, а кривая между кадрами дорожки держит плавность и на тридцати.
 *
 * Шаг (2.11.2026, как у «Анимаций»): «рано ли» и момент позы — по метке развёртки (`frameTime` из `stage-loop.js`), кадр — через одно и то же целое число развёрток (`engine/frame-cadence.js`).
 * Было: порог `1000/60 − 3` мс по `performance.now()` обработчика, который сдвинут внутри кадра на 0,3–8 мс, — на 75 Гц кадры шли то через одну, то через две развёртки, на 165–200 Гц — через две и три
 * вперемешку, а поза бралась со сдвигом обработчика. Медленный темп спит таймером до развёртки перед нужной и рисует на ней, а не «через 30 мс после конца кадра, на какой придётся».
 */
const FAST_FPS = 60;
const LITE_FPS = 30;
const CHARACTER_STEP_MS = 1000 / LITE_FPS;
const LITE_GAP_MS = 23;
const LITE_AFTER_FRAMES = 40;
/* Короче кадра экрана (16 мс) цикл не спит таймером; запас на то, что таймер приходит чуть позже, а кадр ждёт ближайшей развёртки. */
const FRAME_STEP_FLOOR_MS = 17;
const FRAME_STEP_SLACK_MS = 3;

/**
 * Темп кадров живого персонажа: рано ли для кадра и не пора ли на тридцать. `early(frameTime)` — кадр на этой развёртке не рисуется (шаг ещё не прошёл); `drawn(frameTime)` — кадр нарисован (в том числе помимо
 * шага — камера движется): от него считается следующий шаг, и он идёт в скользящее среднее промежутка между кадрами (простой дольше четверти секунды — ворота внимания, не медленная машина — в него не идёт);
 * больше `LITE_GAP_MS` после `LITE_AFTER_FRAMES` кадров — `lite`, и он не отпускает. `step` / `slack` — шаг медленного темпа в развёртках экрана и запас, с которым будить цикл раньше нужной развёртки.
 */
export function createPoseTempo() {
  const cadence = newCadence();
  let drawnAt = 0;
  let gap = 0;
  let frames = 0;
  let lite = false;
  return {
    reset() {
      Object.assign(cadence, newCadence());
      drawnAt = 0;
      gap = 0;
      frames = 0;
      lite = false;
    },
    /* Быстрый темп зовёт кадр каждую развёртку — её промежутки и есть замер; медленный спит таймером — замер остаётся тем, что был. */
    early: (frameTime) => !cadenceDue(cadence, frameTime, { maxFps: lite ? LITE_FPS : FAST_FPS, measure: !lite }),
    drawn(frameTime) {
      cadenceDrawn(cadence, frameTime, { measure: !lite });
      const passed = frameTime - drawnAt;
      drawnAt = frameTime;
      if (passed > 250) return;
      gap = gap ? gap * 0.9 + passed * 0.1 : passed;
      frames += 1;
      if (frames > LITE_AFTER_FRAMES && gap > LITE_GAP_MS) lite = true;
    },
    get lite() {
      return lite;
    },
    get gap() {
      return gap;
    },
    get step() {
      const vsync = vsyncOf(cadence);
      return vsync > 0 ? strideFor(vsync, LITE_FPS) * vsync : CHARACTER_STEP_MS;
    },
    get slack() {
      return Math.max(FRAME_STEP_SLACK_MS, vsyncOf(cadence) / 2);
    },
  };
}

/**
 * Через сколько миллисекунд нужен следующий кадр (контракт `stage-loop.js`): сразу — пока камера движется или персонаж живёт в быстром темпе (кадр на каждую развёртку, лишние пропускает `createPoseTempo`),
 * через шаг покоя за вычетом того, что кадр уже занял, — в медленном (`lite`), `STAGE_IDLE` — когда сцена стоит или цикл остановлен воротами внимания.
 */
export function sceneFrameWait({ moving, alive, stopped, spent = 0, lite = false, step = CHARACTER_STEP_MS, slack = FRAME_STEP_SLACK_MS }) {
  if (stopped) return STAGE_IDLE;
  if (moving) return 0;
  if (!alive) return STAGE_IDLE;
  /* `spent` — от метки развёртки нарисованного кадра: проснуться за `slack` до развёртки через `step`, на ней кадр и нарисуется (`early` отсеет раннюю). */
  return lite ? Math.max(FRAME_STEP_FLOOR_MS, step - spent - slack) : 0;
}
