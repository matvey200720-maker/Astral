import { useEffect, useMemo, useRef, useState } from "react";
import {
  MINIMAP_FILL_FPS,
  fillPreviewFrame,
  fillTile,
  minimapFillActive,
} from "@modovik/minimap-contract";
import { watchFrameGate } from "../../../../attention.js";

/*
 * Холст анимированной заливки полосы (задача 8 ТЗ 05.10.2026).
 *
 * Кадр считает договор (`fillPreviewFrame`) — тот же узор, сдвиг и цвет, что
 * компилятор кладёт в minimap.gfx; своё видео рисуется кадрами его листа,
 * как их показывает игра. Холст во всю длину полосы: игра открывает
 * анимацию маской на долю HP, а не сжимает её, — поэтому и здесь долю
 * отрезает `clip-path` снаружи, а не ширина холста.
 *
 * Анимация идёт, пока холст на экране и окно не просит покоя
 * (`watchFrameGate`); `still` — один кадр (обложки и миниатюры).
 */

/** Картинка листа кадров видео по адресу из хранилища мастерской. */
export function useFillVideoImage(url) {
  const [image, setImage] = useState(null);
  useEffect(() => {
    if (!url) {
      setImage(null);
      return undefined;
    }
    let active = true;
    const element = new Image();
    element.onload = () => active && setImage(element);
    element.onerror = () => active && setImage(null);
    element.src = url;
    return () => {
      active = false;
    };
  }, [url]);
  return image;
}

/* Разрешение холста: точка кадра — не меньше точки экрана, но не роскошь. */
const MAX_WIDTH = 480;
const MAX_HEIGHT = 48;

export default function FillCanvas({
  fill,
  alpha = 1,
  low = "",
  /* Лист кадров своего видео: `{ image, frames, fps, width, height }`. */
  video = null,
  /* Длина полосы к толщине — чтобы узор лёг тем же периодом, что в игре. */
  aspect = 12,
  still = false,
  className = "",
  style,
}) {
  const canvasRef = useRef(null);
  const active = minimapFillActive(fill);
  const tile = useMemo(
    () => (active && fill.mode === "preset" ? fillTile(fill.preset, 1) : null),
    [active, fill?.mode, fill?.preset],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return undefined;
    const height = Math.max(6, Math.min(MAX_HEIGHT, Math.round(MAX_WIDTH / Math.max(1, aspect))));
    const width = Math.max(16, Math.min(MAX_WIDTH, Math.round(height * aspect)));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: fill.mode === "video" });
    if (!context) return undefined;
    const image = context.createImageData(width, height);
    /* Видео: кадр листа как есть, потом — как игра: умножить на цвет малого
       HP (если полоса сейчас красная) и на непрозрачность заливки. */
    const tint = /^#[0-9a-f]{6}$/i.test(low)
      ? [1, 3, 5].map((at) => Number.parseInt(low.slice(at, at + 2), 16) / 255)
      : [1, 1, 1];
    const started = performance.now();
    let frame = 0;
    let shown = -1;
    const draw = (now) => {
      const seconds = still ? 0 : (now - started) / 1000;
      const index = Math.floor(seconds * MINIMAP_FILL_FPS);
      if (index === shown) return;
      shown = index;
      if (fill.mode === "video") {
        context.clearRect(0, 0, width, height);
        if (!video?.image) return;
        const at = Math.floor(seconds * (video.fps || 15)) % Math.max(1, video.frames);
        context.drawImage(video.image, 0, at * video.height, video.width, video.height, 0, 0, width, height);
        if (alpha >= 1 && !low) return;
        const pixels = context.getImageData(0, 0, width, height);
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          pixels.data[offset] *= tint[0];
          pixels.data[offset + 1] *= tint[1];
          pixels.data[offset + 2] *= tint[2];
          pixels.data[offset + 3] *= alpha;
        }
        context.putImageData(pixels, 0, 0);
        return;
      }
      image.data.set(fillPreviewFrame(fill, seconds, { width, height, alpha, low, tile }));
      context.putImageData(image, 0, 0);
    };
    let running = false;
    const loop = (now) => {
      draw(now);
      if (running) frame = requestAnimationFrame(loop);
    };
    draw(started);
    if (still) return undefined;
    const stopGate = watchFrameGate(canvas, (open) => {
      running = open;
      cancelAnimationFrame(frame);
      if (open) frame = requestAnimationFrame(loop);
    });
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      stopGate();
    };
  }, [active, fill, alpha, low, video, aspect, still, tile]);

  if (!active) return null;
  return <canvas ref={canvasRef} className={className} style={style} aria-hidden="true" />;
}
