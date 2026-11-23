/*
 * Кадр вкладки «Ухудшение текстур» — один настоящий кадр из игры, который
 * мылится вслед за ползунком (задача 9, 05.10.2026).
 *
 * В игре ступень срезает у текстур верхние mip: поверхность (стены, дорога,
 * земля) теряет мелкий рисунок, а края предметов остаются чёткими — их
 * рисует геометрия, не текстура. Скрипт делает то же с кадром:
 *
 *   • мыло — кадр уменьшается в 4 … 64 раза (по ступени) и растягивается
 *     обратно с мягким сглаживанием: так выглядит текстура, у которой точек
 *     в столько же раз меньше;
 *   • края — Собель по яркости кадра, уменьшенного вчетверо (мелкий рисунок
 *     текстур в нём уже размыт и краем не считается); по этой маске поверх
 *     мыла ложится исходный кадр.
 *
 * Ступени считаются один раз и запоминаются: ползунок ходит без задержек.
 * Где нет 2D-контекста (тесты, старый браузер), вкладка показывает кадр как
 * есть — подпись под ним всё так же говорит, что ухудшение рисует скрипт.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { edgeAlpha } from "./edge-alpha.js";

/* Маска краёв живёт в своём модуле (см. `edge-alpha.js`); отсюда её берут и прежние адреса. */
export { edgeAlpha };

/** Во сколько раз меньше точек у текстур на ступени: 0 — как в игре. */
export const PREVIEW_FACTORS = Object.freeze([1, 4, 8, 16, 32, 64]);
const EDGE_SCALE = 4;
const EDGE_OPACITY = 0.9;

function canvasOf(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas) {
  try {
    return canvas.getContext("2d") || null;
  } catch {
    return null;
  }
}

/* Уменьшение вдвое за шаг: одним махом в 64 раза сглаживание теряет точки. */
function shrink(image, width, height, factor) {
  let source = image;
  let w = width;
  let h = height;
  while (w / 2 >= width / factor - 0.5 && w > 2) {
    const next = canvasOf(w / 2, h / 2);
    const ctx = context2d(next);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, next.width, next.height);
    source = next;
    w = next.width;
    h = next.height;
  }
  return source;
}

/* Исходный кадр там, где края, — прозрачный слой поверх мыла. */
function edgeLayer(image, width, height) {
  const small = shrink(image, width, height, EDGE_SCALE);
  const smallContext = context2d(small);
  const pixels = smallContext.getImageData(0, 0, small.width, small.height);
  const alpha = edgeAlpha(pixels.data, small.width, small.height);
  const mask = canvasOf(small.width, small.height);
  const maskContext = context2d(mask);
  const maskPixels = maskContext.createImageData(small.width, small.height);
  for (let index = 0; index < alpha.length; index += 1) {
    maskPixels.data[index * 4 + 3] = alpha[index] * EDGE_OPACITY;
  }
  maskContext.putImageData(maskPixels, 0, 0);
  const layer = canvasOf(width, height);
  const ctx = context2d(layer);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mask, 0, 0, width, height);
  ctx.globalCompositeOperation = "source-in";
  ctx.drawImage(image, 0, 0, width, height);
  return layer;
}

/* Кадр ступени: мыло с чёткими краями поверх. Считается один раз на ступень и запоминается в сцене. */
function stepFrame(current, factor) {
  if (!current.steps.has(factor)) {
    const frame = canvasOf(current.width, current.height);
    const frameContext = context2d(frame);
    frameContext.imageSmoothingEnabled = true;
    frameContext.imageSmoothingQuality = "high";
    const small = shrink(current.image, current.width, current.height, factor);
    frameContext.drawImage(small, 0, 0, current.width, current.height);
    frameContext.drawImage(current.edges, 0, 0);
    current.steps.set(factor, frame);
  }
  return current.steps.get(factor);
}

const factorOf = (step) => PREVIEW_FACTORS[Math.max(0, Math.min(PREVIEW_FACTORS.length - 1, step))] || 1;

/**
 * Рисует кадр ступени в `canvasRef`. `{ ready, supported, frameFor }`: `supported:
 * false` — 2D-контекста нет, вкладка показывает кадр картинкой; `frameFor(ступень)` —
 * готовый кадр ступени (холст или исходный кадр) для плёнки шагов: те же кадры, что в сцене, из того же запоминания.
 */
export function useTexturePreview(canvasRef, url, step, showOriginal) {
  const scene = useRef(null);
  const [state, setState] = useState({ ready: false, supported: true });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return undefined;
    if (!context2d(canvas)) {
      setState({ ready: false, supported: false });
      return undefined;
    }
    let alive = true;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!alive) return;
      const width = image.naturalWidth || 1280;
      const height = image.naturalHeight || 720;
      canvas.width = width;
      canvas.height = height;
      try {
        scene.current = { image, width, height, edges: edgeLayer(image, width, height), steps: new Map() };
        setState({ ready: true, supported: true });
      } catch {
        setState({ ready: false, supported: false });
      }
    };
    image.onerror = () => alive && setState({ ready: false, supported: false });
    image.src = url;
    return () => {
      alive = false;
      scene.current = null;
    };
  }, [canvasRef, url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const current = scene.current;
    if (!state.ready || !canvas || !current) return;
    const ctx = context2d(canvas);
    const factor = factorOf(step);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, current.width, current.height);
    if (showOriginal || factor === 1) {
      ctx.drawImage(current.image, 0, 0, current.width, current.height);
      return;
    }
    ctx.drawImage(stepFrame(current, factor), 0, 0);
  }, [canvasRef, state.ready, step, showOriginal]);

  const frameFor = useCallback((index) => {
    const current = scene.current;
    if (!current) return null;
    const factor = factorOf(index);
    return factor === 1 ? current.image : stepFrame(current, factor);
  }, []);

  return useMemo(() => ({ ...state, frameFor }), [state, frameFor]);
}

/*
 * Кадры плёнки шагов (дизайн 15.11.2026): по кадру на ступень — часть того же кадра в натуральную величину у стены гаража, мыло и края те
 * же, что в сцене (`frameFor`). Шесть кадров не считаются разом: после первого рисунка сцены по одному, в простое окна, так что ползунок
 * и первый показ вкладки не ждут. Читать холст не нужно — только `drawImage` готового кадра.
 */
export const FILM_CROP = Object.freeze({ x: 206, y: 190, width: 240, height: 120 });

export function useTextureFilmTiles(ready, frameFor, tiles, count) {
  useEffect(() => {
    if (!ready) return undefined;
    const idle = typeof window.requestIdleCallback === "function";
    const schedule = (run) => (idle ? window.requestIdleCallback(run, { timeout: 400 }) : window.setTimeout(run, 24));
    const cancel = (handle) => (idle ? window.cancelIdleCallback(handle) : window.clearTimeout(handle));
    let cancelled = false;
    let handle = 0;
    let index = 0;
    const next = () => {
      if (cancelled || index >= count) return;
      const at = index;
      index += 1;
      const canvas = tiles.current[at];
      const ctx = canvas ? context2d(canvas) : null;
      const frame = ctx ? frameFor(at) : null;
      if (ctx && frame) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frame, FILM_CROP.x, FILM_CROP.y, FILM_CROP.width, FILM_CROP.height, 0, 0, canvas.width, canvas.height);
      }
      handle = schedule(next);
    };
    handle = schedule(next);
    return () => {
      cancelled = true;
      cancel(handle);
    };
  }, [ready, frameFor, tiles, count]);
}
