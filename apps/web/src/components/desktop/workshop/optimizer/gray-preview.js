/*
 * Кадр вкладки «ЧБ-мир» (ТЗ 17.10.2026, задача 10): настоящий кадр из игры,
 * который приложение красит в серый тем же правилом, что хост — текстуры
 * (`grayscaleRgba`, яркость Rec. 709, `@modovik/optimizer/texture-stages.js`).
 *
 * Кадра ЧБ-мира из самой игры у Astral нет, поэтому подпись вкладки говорит
 * прямо: серым кадр делает приложение, и делает его серым целиком — а в игре
 * люди, небо, вода и свет останутся цветными.
 *
 * Серый вариант каждого кадра считается один раз и запоминается: щелчок по
 * выключателю и смена кадра — без задержек. Где нет 2D-контекста (тесты,
 * старый браузер), вкладка показывает кадр картинкой.
 */

import { useEffect, useRef, useState } from "react";
import { grayscaleRgba } from "@modovik/optimizer/texture-stages.js";

function context2d(canvas) {
  try {
    return canvas.getContext("2d") || null;
  } catch {
    return null;
  }
}

/** Серая копия кадра: холст того же размера. */
function grayFrame(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = context2d(canvas);
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  grayscaleRgba(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * Рисует кадр `url` в `canvasRef`: серым, если `gray` и не зажат «оригинал».
 * `{ ready, supported }`: `supported: false` — 2D-контекста нет.
 */
export function useGrayPreview(canvasRef, url, gray, showOriginal) {
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
    setState({ ready: false, supported: true });
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!alive) return;
      const width = image.naturalWidth || 1280;
      const height = image.naturalHeight || 720;
      canvas.width = width;
      canvas.height = height;
      scene.current = { image, width, height, gray: null };
      setState({ ready: true, supported: true });
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
    ctx.clearRect(0, 0, current.width, current.height);
    if (!gray || showOriginal) {
      ctx.drawImage(current.image, 0, 0, current.width, current.height);
      return;
    }
    try {
      current.gray ||= grayFrame(current.image, current.width, current.height);
      ctx.drawImage(current.gray, 0, 0);
    } catch {
      /* Холст «испачкан» чужим источником — кадр как есть, подпись честная. */
      ctx.drawImage(current.image, 0, 0, current.width, current.height);
    }
  }, [canvasRef, state.ready, gray, showOriginal]);

  return state;
}
