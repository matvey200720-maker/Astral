/*
 * Плитка с 3D-снимком сцены набора: готовый вид в редакторе, обложка на
 * полке. Настоящие модели в облике вида — тем же кадром, что у редактора
 * (`scene-snapshot.js`), а не схема. Пока снимок готовится — пустая матовая
 * плашка карточки.
 *
 * Снимок берётся из хранилища обложек, если он уже снимался (`sceneThumbUrl`),
 * и снимается, только когда плитка подъезжает к экрану: плитки ниже края
 * полки и в свёрнутых панелях не занимают общий кадр снимков.
 */

import { useEffect, useRef, useState } from "react";
import { useCoverDrawn, useCoverPending, useCoverProvisional } from "../covers/cover-bake-context.js";
import { sceneThumbUrl, thumbIsProvisional } from "./scene-snapshot.js";

/* Размер снимка — ступенями: плитки чуть разной ширины (окно, колонки)
   берут один и тот же кадр из хранилища, а не снимают свой. Ступень — у
   ширины и у пропорции плитки (в сотых), высота выходит из них: прежде ширина
   (64) и высота (40) округлялись врозь, пропорция снимка уходила от плитки, а
   холст растягивался на плитку — картинка плыла и обрезалась. */
const quantize = (value, step, min) => Math.max(min, Math.ceil(value / step) * step);
const ASPECT_STEP = 50;

/** Размер снимка плитки `box`: ширина ступенью, высота — по пропорции плитки. */
export function thumbSize(box, ratio = 1) {
  const wide = box?.width > 8 && box?.height > 8;
  const aspect = wide ? Math.round((box.width / box.height) * ASPECT_STEP) / ASPECT_STEP : 1.6;
  const width = quantize((wide ? box.width : 240) * ratio, 64, 160);
  return { width, height: Math.max(64, Math.round(width / aspect)) };
}

/* Снимок без листов игры, что ещё едут, — временный: плитка дорисуется. Ещё
   две попытки с растущей паузой; дальше — как есть (игры нет или листов в ней
   нет), обложку не запекаем, а плитку не мучаем снимками. */
const RETRY_MS = 4000;
const RETRIES = 2;

function whenNearScreen(element, callback) {
  if (typeof IntersectionObserver !== "function") {
    callback();
    return () => {};
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        callback();
      }
    },
    { rootMargin: "320px" },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

/**
 * `scene` — адрес сцены; `look(index, info)` — облик материала; `lookKey` —
 * его отпечаток (ключ снимков); `frame(asset)` — рамка кадра; `parts` —
 * видимые части; `objects()` — свои объекты кадра (плашки зданий): их
 * заводит и освобождает снимок. `prepare()` и `sceneKey` — ленивая
 * подготовка и имя сцены без постоянного адреса (`sceneThumbUrl`);
 * `onResult(drawn)` — снимок нарисован или его нет (обложке — показать
 * схему вместо пустой плашки).
 */
export default function SceneThumb({ scene, look, lookKey, frame, parts = null, objects = null, prepare = null, sceneKey = "", onResult = null, className = "" }) {
  const canvasRef = useRef(null);
  /* Печь обложек ждёт снимок, а не снимает пустую плашку (`cover-oven.jsx`). */
  const [waiting, setWaiting] = useState(Boolean(scene || sceneKey));
  useCoverPending(waiting);
  const drawnRef = useRef(null);
  drawnRef.current = useCoverDrawn();
  const provisionalRef = useRef(null);
  provisionalRef.current = useCoverProvisional();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (!scene && !sceneKey)) return undefined;
    let cancelled = false;
    /* Плитка ушла (закрыли полку, сменили облик) — её снимок из очереди выпадает. */
    const gone = typeof AbortController === "function" ? new AbortController() : null;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const { width, height } = thumbSize(box, ratio);
    let retryTimer = 0;
    setWaiting(true);
    const done = (drawn, more = false) => {
      if (drawn) drawnRef.current(canvas);
      /* Ждём новой попытки — печь не снимает кадр, пока листы не доедут. */
      if (!more) setWaiting(false);
      onResult?.(drawn);
    };
    const stop = whenNearScreen(canvas, () => {
      sceneThumbUrl({ url: scene, look, frame, parts, objects, prepare, sceneKey, key: lookKey, width, height, signal: gone?.signal }).then(async (url) => {
        if (cancelled) return;
        if (!url) {
          done(false);
          return;
        }
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        try {
          await image.decode();
        } catch {
          if (!cancelled) done(false);
          return;
        }
        if (cancelled) return;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        canvas.dataset.ready = "true";
        const temporary = thumbIsProvisional(url);
        /* Печи — до «нарисовала»: временный кадр она не запекает. */
        provisionalRef.current(temporary);
        const more = temporary && attempt < RETRIES;
        if (more) retryTimer = window.setTimeout(() => setAttempt((count) => count + 1), RETRY_MS * (attempt + 1));
        done(true, more);
      });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      gone?.abort();
      stop();
    };
    // Снимок меняется ключом облика (и новой попыткой), а не каждой новой функцией.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, sceneKey, lookKey, attempt]);

  return <canvas ref={canvasRef} className={`scene-thumb${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}
