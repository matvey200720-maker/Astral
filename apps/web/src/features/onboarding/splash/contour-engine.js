/*
 * Заставка «Контур»: цикл кадров (15.11.2026). Едет отдельным куском (`import()` из `StartupSplashView.jsx`): пока он грузится,
 * стоят неподвижный знак и слова, так что запуск от него не зависит.
 *
 * Кадр — функция забега (`contour-model.js`), забег шагает по времени кадров и по ходу запуска (`startup-flow.js`). Цикл идёт
 * только пока окно видно: в свёрнутом окне заставка не держит процессор, а забег стоит на месте.
 */

import {
  advance,
  EXIT_SOFT,
  SOFT_STEP_MS,
  calmPlan,
  createRun,
  framePlan,
  launchDurations,
  layoutOf,
  phaseOf,
  stateOf,
  trackFill,
} from "./contour-model.js";
import { drawFrame } from "./contour-draw.js";
import { markLanding } from "./landing.js";
import { readExpect, rememberLaunch } from "./launch-memory.js";

const MAX_STEP_MS = 100;
const FILL_STEP = 0.002;

/**
 * Запуск цикла. `root` — слой заставки, `canvas` — холст (нужен без `calm`), `veil` — тёмный фон слоя, `track` — заливки четырёх
 * отрезков хода. `onPhase(phase)` — слова поменялись, `onExit()` — начался уход, `onFinish()` — уход закончен. `hold()` — следующий экран ещё не готов.
 * Возвращает функцию остановки.
 */
export function startContour({
  root,
  canvas,
  veil,
  track,
  flow,
  calm = false,
  onPhase,
  onFinish,
  onExit,
  hold,
}) {
  const ctx = calm ? null : canvas.getContext("2d");
  let run = createRun();
  const expect = readExpect(); // ожидаемые длительности лучей — по прошлым запускам окна
  let geometry = layoutOf(1, 1);
  let ratio = 1;
  let last = performance.now();
  let frame = 0;
  let phaseKey = "";
  let exit = null;
  let finished = false;
  const fills = track.map(() => -1);

  function measure() {
    const box = root.getBoundingClientRect();
    geometry = layoutOf(box.width, box.height);
    if (!canvas) return;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function setVar(name, value) {
    root.style.setProperty(name, Number(value).toFixed(3));
  }

  function words(state) {
    const phase = phaseOf(state);
    const key = `${phase.kind}:${phase.index}:${phase.long ? 1 : 0}`;
    if (key !== phaseKey) {
      phaseKey = key;
      onPhase?.(phase);
    }
    track.forEach((el, i) => {
      const share = trackFill(state.L, i);
      if (
        Math.abs(share - fills[i]) >= FILL_STEP ||
        (share === 1 && fills[i] !== 1) ||
        (share === 0 && fills[i] !== 0)
      ) {
        fills[i] = share;
        el.style.transform = `scaleX(${share.toFixed(3)})`;
      }
      el.parentElement.toggleAttribute(
        "data-wait",
        phase.long && i === state.k,
      );
    });
  }

  function beginExit() {
    if (exit) return;
    const landing = calm ? { el: null, land: null } : markLanding();
    const asked = import.meta.env.DEV
      ? new URLSearchParams(location.search).get("qa-splash-next")
      : null;
    exit = {
      next:
        asked ||
        (document.querySelector(".product-onboarding") ? "login" : "home"),
      ...landing,
    };
    if (exit.el) exit.el.style.visibility = "hidden";
    onExit?.();
  }

  function giveBackMark() {
    if (exit?.el) exit.el.style.visibility = "";
  }

  function paint(state) {
    if (calm) {
      const plan = calmPlan(state);
      setVar("--ss-lit", plan.lit);
      setVar("--ss-star", plan.starAlpha);
      setVar("--ss-text", plan.textAlpha);
      if (state.exit > 0) veil.style.opacity = plan.veilAlpha.toFixed(3);
      return;
    }
    const plan = framePlan(state, geometry, {
      next: exit?.next,
      land: exit?.land || undefined,
    });
    drawFrame(ctx, plan, geometry);
    if (state.exit <= 0) return;
    setVar("--ss-text", plan.textAlpha);
    if (plan.mode === "home") {
      veil.style.opacity = plan.veilAlpha.toFixed(3);
      return;
    }
    const r = plan.reveal;
    const mask = `radial-gradient(circle at ${geometry.cx.toFixed(0)}px ${geometry.cy.toFixed(0)}px,transparent 0,transparent ${(r * 0.55).toFixed(0)}px,#000 ${Math.max(1, r).toFixed(0)}px)`;
    veil.style.maskImage = mask;
    veil.style.webkitMaskImage = mask;
  }

  function step(now) {
    frame = 0;
    if (finished) return;
    const limit =
      exit && stateOf(run).exit < EXIT_SOFT ? SOFT_STEP_MS : MAX_STEP_MS;
    const dt = Math.min(Math.max(now - last, 0), limit);
    last = now;
    run = advance(run, dt, {
      closed: flow.closed(),
      ready: flow.isReady(),
      hold: hold?.() === true,
      fail: flow.isFailed(),
      expect,
    });
    const state = stateOf(run);
    if (state.exit > 0) beginExit();
    words(state);
    paint(state);
    if (state.exit >= 1) {
      finished = true;
      rememberLaunch(launchDurations(run));
      giveBackMark();
      onFinish?.();
      return;
    }
    if (!document.hidden) frame = requestAnimationFrame(step);
  }

  function onVisibility() {
    if (document.hidden || finished) return;
    last = performance.now();
    if (!frame) frame = requestAnimationFrame(step);
  }

  // Размер слоя следим наблюдателем: окно меняет размер и без события `resize` (полоса прокрутки, рамка окна).
  let repaint = () => {};
  const watch = new ResizeObserver(() => {
    measure();
    repaint();
  });
  watch.observe(root);
  measure();
  // Песочница: `?qa-splash-at=<мс>` — один кадр на этот миг, как `?T=` у макета (в продуктовой сборке этого кода нет).
  if (import.meta.env.DEV && flow.qa?.frozenAt != null) {
    for (let at = 0; at < flow.qa.frozenAt; at += 4) {
      run = advance(run, 4, {
        closed: flow.qa.closedAt(at),
        ready: flow.qa.readyAt(at),
        hold: false,
        fail: flow.qa.failedAt(at),
      });
    }
    const state = stateOf(run);
    if (state.exit > 0) beginExit();
    repaint = () => paint(state);
    words(state);
    paint(state);
    return () => {
      watch.disconnect();
      giveBackMark();
    };
  }
  document.addEventListener("visibilitychange", onVisibility);
  step(last); // первый кадр сразу: пока холст пуст, неподвижный знак из разметки остаётся на месте
  return () => {
    finished = true;
    cancelAnimationFrame(frame);
    watch.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    giveBackMark();
  };
}
