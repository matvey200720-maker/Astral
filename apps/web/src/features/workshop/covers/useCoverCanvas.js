import { useEffect, useRef } from "react";
import { motionLeft } from "../../../components/ui/motion-quiet.js";
import {
  context2d,
  previewRatio,
} from "../../../components/desktop/workshop/effects-preview.js";
import { useCoverDrawn } from "./cover-bake-context.js";

/*
 * Холст обложки: размер от плитки, рисунок — от вызывающего.
 *
 * Обложка неподвижна, поэтому кадрового цикла здесь нет: рисуем один раз и
 * заново — когда поменялся размер плитки или то, что на ней нарисовано.
 * Мерится родитель, а не сам холст: отрисовка пишет холсту `width` и
 * `height`, и наблюдатель за ним самим будил бы себя по кругу.
 *
 * `paint(context, { width, height })` получает контекст уже в CSS-пикселях.
 * В среде без canvas (jsdom) контекста нет — обложка просто остаётся плашкой.
 *
 * `paint` может вернуть `false`: кадр неокончательный — лист, снимок или
 * картинка ещё едут, и обложка дорисуется, когда они приедут. Печь обложек
 * (`cover-oven.jsx`) такой кадр не снимает; любой другой ответ — «нарисовала».
 */

/*
 * Очередь отрисовки (задача 6 ТЗ 10.10.2026). Полка мастерской — два-три
 * десятка обложек. Выход из редактора рисовал их все одним длинным кадром, а
 * пока возвращалась рейка, сетка меняла ширину каждый кадр — и каждая обложка
 * рисовалась заново в каждом кадре (стенд `npm run perf`: до трети кадров
 * перехода терялось, худший кадр — обложка в `ResizeObserver`). Теперь
 * обложки рисуются в кадрах по очереди, не дольше FRAME_BUDGET_MS за кадр, а
 * новая ширина ждёт, пока устоится (SETTLE_MS): до тех пор холст растянут
 * прежним рисунком, и на ходу глаз этого не видит. Пока едут рейка и волна
 * карточек (`motion-quiet.js`), доля кадра на обложки — вдвое меньше.
 */
const FRAME_BUDGET_MS = 6;
const MOTION_BUDGET_MS = 3;
const SETTLE_MS = 160;
const pending = new Set();
let pumping = false;

const nextFrame = (callback) =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 16);

function pump() {
  pumping = false;
  const started = performance.now();
  const budget = motionLeft() ? MOTION_BUDGET_MS : FRAME_BUDGET_MS;
  for (const job of pending) {
    pending.delete(job);
    job();
    if (performance.now() - started >= budget) break;
  }
  if (pending.size) schedule();
}

function schedule() {
  if (pumping) return;
  pumping = true;
  nextFrame(pump);
}

function enqueue(job) {
  pending.add(job);
  schedule();
}

/**
 * Все поставленные перерисовки обложек выполнены. Печь обложек
 * (`cover-oven.jsx`) снимает кадр только тогда: обложка, у которой лист
 * доехал и ушло «ещё не всё», перерисовывается кадром позже — а печь могла
 * снять холст раньше (в свёрнутом окне или после долгой задачи) и запечь
 * недорисованный кадр на трое суток.
 */
export const coverCanvasesIdle = () => pending.size === 0 && !pumping;

/*
 * Скорость 12.10: готовые рисунки обложек между заходами на полку. Полка
 * собирается заново при каждом входе в «Мастерскую», и обложка, которая
 * считается дорого (фонарь — модель света игры на процессоре, ~55 мс),
 * пересчитывалась каждый раз — длинным кадром посреди волны карточек. Если
 * вызывающий назвал ключ, однозначно задающий рисунок (`cacheKey`), рисунок
 * того же размера берётся копией. Холст обложки — пара сотен килобайт;
 * держим последние COVER_CACHE_LIMIT.
 */
const COVER_CACHE_LIMIT = 24;
const coverCache = new Map();

function cachedCover(key) {
  const hit = coverCache.get(key);
  if (!hit) return null;
  coverCache.delete(key);
  coverCache.set(key, hit);
  return hit;
}

function rememberCover(key, canvas) {
  if (typeof document === "undefined") return;
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext("2d");
  if (!context) return;
  context.drawImage(canvas, 0, 0);
  coverCache.delete(key);
  coverCache.set(key, copy);
  while (coverCache.size > COVER_CACHE_LIMIT)
    coverCache.delete(coverCache.keys().next().value);
}

/**
 * `cacheKey` — необязательная строка, которая целиком задаёт рисунок (без
 * картинок, догружаемых после первого кадра): с ней повторный заход берёт
 * готовый рисунок, а не рисует заново.
 */
export function useCoverCanvas(paint, deps, cacheKey = null) {
  const canvasRef = useRef(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;
  const drawnRef = useRef(null);
  drawnRef.current = useCoverDrawn();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = context2d(canvas);
    const box = canvas?.parentElement;
    if (!canvas || !context || !box) return undefined;
    let last = "";
    let settle = null;
    const draw = (force = false) => {
      const rect = box.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const key = `${width}x${height}`;
      if (!force && key === last) return;
      last = key;
      const ratio = previewRatio();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const cacheId =
        typeof keyRef.current === "string"
          ? `${keyRef.current}|${canvas.width}x${canvas.height}`
          : null;
      const ready = cacheId ? cachedCover(cacheId) : null;
      if (ready) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(ready, 0, 0);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawnRef.current(canvas);
        return;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const final = paintRef.current(context, { width, height }) !== false;
      if (cacheId && final) rememberCover(cacheId, canvas);
      if (final) drawnRef.current(canvas);
    };
    const forced = () => draw(true);
    const resized = () => draw(false);
    enqueue(forced);
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            clearTimeout(settle);
            settle = setTimeout(() => enqueue(resized), SETTLE_MS);
          })
        : null;
    observer?.observe(box);
    return () => {
      observer?.disconnect();
      clearTimeout(settle);
      pending.delete(forced);
      pending.delete(resized);
    };
    // Перерисовка — по зависимостям вызывающего: сам `paint` живёт в ссылке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return canvasRef;
}
