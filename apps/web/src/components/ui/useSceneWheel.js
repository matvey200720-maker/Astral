import { useEffect, useRef } from "react";
import { markWheel } from "./wheel-mark.js";

export const WHEEL_NOTCH_PX = 100;
export const GESTURE_GAP_MS = 240;

// Строка прокрутки (Firefox) — треть щелчка, страница — три щелчка.
const LINE_PX = WHEEL_NOTCH_PX / 3;
const PAGE_PX = WHEEL_NOTCH_PX * 3;
const WHEEL_ZOOM_LIMIT = 400;
const PINCH_LIMIT = 60;
const PINCH_SENSITIVITY = 0.012;
const DEFAULT_STEP = 1.16;

// Во сколько точек превращается единица прокрутки в режиме события; прочие режимы — пиксели.
const MODE_SCALES = new Map([
  [1, LINE_PX],
  [2, PAGE_PX],
]);
// Эти виды жеста держатся, пока он не оборвался.
const HELD_KINDS = new Set(["zoom", "pan"]);

const clampTo = (limit, value) => Math.min(Math.max(value, -limit), limit);

/** Прокрутка события в точках; неизвестный режим считается пикселями. */
export function wheelPixels(event) {
  const { deltaMode } = event;
  const scale = MODE_SCALES.get(deltaMode) ?? 1;
  const along = (delta) => (Number(delta) || 0) * scale;
  return { x: along(event.deltaX), y: along(event.deltaY) };
}

function wholeNotches(notched) {
  if (Math.abs(notched) < 120) return false;
  return notched % 120 === 0;
}

function mouseByNotches(event, notched) {
  if (typeof notched === "number" && notched !== 0) return wholeNotches(notched);
  const strong = Math.abs(event.deltaY) >= 50;
  return strong ? Number.isInteger(event.deltaY) : false;
}

/** Колесо мыши щелчками (а не трекпад и не плавная мышь). */
export function isMouseWheel(event) {
  return event.deltaMode ? true : event.deltaX ? false : mouseByNotches(event, event.wheelDeltaY);
}

function panByNotches(event, notched) {
  const measurable = typeof notched === "number" && notched !== 0 && event.deltaY;
  return measurable && notched % 120 !== 0 ? Math.abs(notched + 3 * event.deltaY) < 1 : false;
}

/** Два пальца по трекпаду. Chrome на Mac присылает wheelDeltaY, равное −3·deltaY. */
export function isTrackpadPan(event) {
  if (event.ctrlKey || event.deltaMode) return false;
  return event.deltaX ? true : panByNotches(event, event.wheelDeltaY);
}

/** Вид жеста; щипок (ctrl) главнее всего, zoom и pan держатся, пока жест не оборвался. */
export function wheelKind(event, previous = null) {
  return event.ctrlKey
    ? "pinch"
    : HELD_KINDS.has(previous)
      ? previous
      : isMouseWheel(event) || !isTrackpadPan(event)
        ? "zoom"
        : "pan";
}

const zoomIntent = (factor, glide) => ({ kind: "zoom", factor, glide });

const INTENT_BUILDERS = new Map([
  ["pinch", (event) => zoomIntent(Math.exp(-clampTo(PINCH_LIMIT, event.deltaY) * PINCH_SENSITIVITY), false)],
  [
    "zoom",
    (event, step) => {
      const delta = clampTo(WHEEL_ZOOM_LIMIT, wheelPixels(event).y);
      return zoomIntent(step ** (-delta / WHEEL_NOTCH_PX), true);
    },
  ],
]);

// Всё, что не щипок и не zoom, — сдвиг.
function panIntent(event) {
  const { x, y } = wheelPixels(event);
  return { kind: "pan", dx: x, dy: y };
}

export function wheelIntent(event, { step = DEFAULT_STEP, kind = wheelKind(event) } = {}) {
  return (INTENT_BUILDERS.get(kind) ?? panIntent)(event, step);
}

// Событие пришло из прокручиваемого листа поверх сцены (ignore — его селектор).
const insideIgnored = (event, selector) => selector && event.target instanceof Element && event.target.closest(selector);

// Слушатель одного подключения: помнит вид и время последнего события жеста.
function sceneWheelListener({ latest, step, ignore }) {
  let lastKind = null;
  let lastTime = 0;

  return (event) => {
    if (insideIgnored(event, ignore)) return;
    event.preventDefault();

    const stamp = event.timeStamp;
    const now = Number.isFinite(stamp) && stamp > 0 ? stamp : performance.now();
    const kind = wheelKind(event, now - lastTime < GESTURE_GAP_MS ? lastKind : null);
    [lastKind, lastTime] = [kind, now];

    latest.current?.(wheelIntent(event, { step, kind }), event);
  };
}

const WHEEL_EVENT = "wheel";
const WHEEL_OPTIONS = { passive: false };

// Подписка на колесо с запретом прокрутки страницы; возвращает отмену.
function attachWheel(element, listener) {
  const saved = element.style.overscrollBehavior;
  element.style.overscrollBehavior = "contain";
  // Явная метка для сверки экрана (правило `scroll`): колесо здесь — масштаб сцены, а не прокрутка.
  const unmarkWheel = markWheel(element);
  element.addEventListener(WHEEL_EVENT, listener, WHEEL_OPTIONS);
  return () => {
    element.removeEventListener(WHEEL_EVENT, listener);
    element.style.overscrollBehavior = saved;
    unmarkWheel();
  };
}

/**
 * Колесо над сценой управляет сценой, а не страницей: слушатель нативный и непассивный,
 * событие гасится при любом исходе. `ignore` — прокручиваемый лист поверх сцены.
 */
export function useSceneWheel(stageRef, onWheel, { enabled = true, ignore = "", step } = {}) {
  // Слушатель читает onWheel в момент события: новая функция его не пересоздаёт.
  const latest = useRef(onWheel);
  useEffect(() => {
    latest.current = onWheel;
  });

  useEffect(() => {
    const element = stageRef.current;
    return element && enabled ? attachWheel(element, sceneWheelListener({ latest, step, ignore })) : undefined;
  }, [stageRef, enabled, step, ignore]);
}
