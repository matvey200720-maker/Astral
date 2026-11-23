/*
 * Заставка «Контур»: хозяин воркера на главном потоке (17.11.2026). Холст рисует воркер (`contour-worker.js`, цикл —
 * `contour-loop.js`), поэтому свет не рвётся, когда под заставкой разбирается каталог и собирается оболочка. Здесь остаётся то,
 * что без DOM не сделать: следить за ходом запуска и отдавать его воркеру, показывать слова и заливки четырёх отрезков, мерить
 * место посадки знака и вести слой ухода (прозрачность слов, фон, маска облака).
 *
 * Воркера или `OffscreenCanvas` нет (тесты, старый Chromium), воркер не поднялся за `READY_MS` или упал на загрузке — хозяин
 * возвращает `null`, и слой запускает прежний цикл на главном потоке (`contour-engine.js`). Холст при этом цел: отдаётся воркеру
 * не он, а свой, свежий (отдать можно один раз, а строгий режим React запускает эффект дважды).
 */

import { layoutOf, trackFill } from "./contour-model.js";
import { readExpect, rememberLaunch } from "./launch-memory.js";
import { markLanding } from "./landing.js";

const POLL_MS = 40;
const READY_MS = 4000;
const FILL_STEP = 0.002;

const fromWorker = () =>
  typeof Worker === "function" && typeof OffscreenCanvas === "function";

/**
 * Запуск. Вернёт функцию остановки или `null`, если воркер не годится. Параметры те же, что у `startContour` (`root`, `canvas`,
 * `veil`, `track`, `flow`, `onPhase`, `onFinish`, `hold`), плюс `onLive()` — первый кадр нарисован, знак из разметки можно
 * убрать, и `onBroken()` — воркер упал на ходу (слой ждёт конца запуска без картинки).
 */
export function startContourHosted(options) {
  const { canvas } = options;
  if (!fromWorker() || typeof canvas?.transferControlToOffscreen !== "function")
    return Promise.resolve(null);
  let worker;
  try {
    worker = new Worker(new URL("./contour-worker.js", import.meta.url), {
      type: "module",
    });
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => settle(null), READY_MS);
    function settle(stop) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (!stop) worker.terminate();
      resolve(stop);
    }
    worker.onerror = () => settle(null);
    worker.onmessage = (event) => {
      if (event.data?.type === "ready") settle(attach(worker, options));
    };
  });
}

function attach(worker, options) {
  const { root, canvas, veil, track, flow, onPhase, onFinish, hold } = options;
  const surface = canvas.cloneNode(false);
  canvas.after(surface);
  let geometry = layoutOf(1, 1);
  let phaseKey = "";
  let landingEl = null;
  let sent = null;
  let done = false;
  const fills = track.map(() => -1);

  const measure = () => {
    const box = root.getBoundingClientRect();
    geometry = layoutOf(box.width, box.height);
    return {
      width: box.width,
      height: box.height,
      ratio: Math.min(window.devicePixelRatio || 1, 2),
    };
  };
  const snapshot = () => ({
    closed: flow.closed(),
    ready: flow.isReady(),
    hold: hold?.() === true,
    fail: flow.isFailed(),
  });
  const push = () => {
    const now = snapshot();
    if (
      sent &&
      sent.closed === now.closed &&
      sent.ready === now.ready &&
      sent.hold === now.hold &&
      sent.fail === now.fail
    )
      return;
    sent = now;
    worker.postMessage({ type: "input", ...now });
  };
  const setVar = (name, value) =>
    root.style.setProperty(name, Number(value).toFixed(3));

  /* Слова и заливки: то же, что делал цикл на главном потоке. */
  function words(view) {
    const key = `${view.phase.kind}:${view.phase.index}:${view.phase.long ? 1 : 0}`;
    if (key !== phaseKey) {
      phaseKey = key;
      onPhase?.(view.phase);
    }
    track.forEach((el, i) => {
      const share = trackFill(view.L, i);
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
        view.phase.long && i === view.k,
      );
    });
  }

  /* Слой ухода: слова гаснут, фон уходит или раскрывается облаком. */
  function leaving(plan) {
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

  /* Уход начался: настоящий знак шапки прячется, воркеру уходит место посадки и куда уходим. */
  function beginExit() {
    const landing = markLanding();
    const asked = import.meta.env.DEV
      ? new URLSearchParams(location.search).get("qa-splash-next")
      : null;
    landingEl = landing.el;
    if (landingEl) landingEl.style.visibility = "hidden";
    options.onExit?.();
    worker.postMessage({
      type: "exit",
      next:
        asked ||
        (document.querySelector(".product-onboarding") ? "login" : "home"),
      land: landing.land,
    });
  }

  function giveBack() {
    if (landingEl) landingEl.style.visibility = "";
  }

  function stop() {
    done = true;
    window.clearInterval(poll);
    watch.disconnect();
    worker.terminate();
    surface.remove();
    giveBack();
  }

  worker.onmessage = (event) => {
    if (done) return;
    const data = event.data;
    if (data.type === "view") {
      words(data);
      if (data.exit > 0 && data.plan) leaving(data.plan);
    } else if (data.type === "first") options.onLive?.();
    else if (data.type === "exit-begin") beginExit();
    else if (data.type === "finish") {
      rememberLaunch(data.durations);
      giveBack();
      done = true;
      window.clearInterval(poll);
      onFinish?.();
    }
  };
  worker.onerror = () => {
    if (done) return;
    stop();
    options.onBroken?.();
  };

  const offscreen = surface.transferControlToOffscreen();
  const first = snapshot();
  sent = first;
  worker.postMessage(
    {
      type: "init",
      canvas: offscreen,
      ...measure(),
      input: first,
      expect: readExpect(),
    },
    [offscreen],
  );
  const poll = window.setInterval(push, POLL_MS);
  const watch = new ResizeObserver(() =>
    worker.postMessage({ type: "size", ...measure() }),
  );
  watch.observe(root);
  return stop;
}
