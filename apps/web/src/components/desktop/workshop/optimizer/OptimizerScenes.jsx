import { useEffect, useRef, useState } from "react";
import { grayscaleRgba } from "@modovik/optimizer/texture-stages.js";
import "./optimizer-film.css";

/*
 * Кадры предпросмотра «ЧБ-мира» и «Стиля мира» (дизайн 15.11.2026): четыре настоящих кадра игры (`assets/optimization-shots`). У «ЧБ-мира» они лежат
 * в плёнке под сценой маленькими плитками — серыми, когда ЧБ-мир или серый кадр включены, тем же правилом (`grayscaleRgba`, Rec. 709), что и кадр
 * сцены. Плитка 384×216 считается один раз на кадр и серость, на холсте без чтения с видеочипа (2D с `willReadFrequently`).
 */

/* Кадры из игры: город днём, природа, аэропорт, ночь. `position` — куда смотрит рамка у плитки и сцены (`object-position`). */
export const OPTIMIZER_SCENES = Object.freeze([
  {
    id: "streets",
    shot: "streets-before",
    label: "Улица днём",
    position: "50% 62%",
  },
  {
    id: "vegetation",
    shot: "vegetation-before",
    label: "Склон Вайнвуда",
    position: "50% 30%",
  },
  {
    id: "vehicles",
    shot: "vehicles-before",
    label: "Аэропорт",
    position: "50% 62%",
  },
  {
    id: "night",
    shot: "shadows-before",
    label: "Заправка ночью",
    position: "50% 60%",
  },
]);

const TILE_W = 384;
const TILE_H = 216;

function useSceneTile(canvasRef, url, gray) {
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return undefined;
    let ctx = null;
    try {
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    } catch {
      ctx = null;
    }
    if (!ctx) {
      setSupported(false);
      return undefined;
    }
    let alive = true;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!alive) return;
      ctx.clearRect(0, 0, TILE_W, TILE_H);
      ctx.drawImage(image, 0, 0, TILE_W, TILE_H);
      if (!gray) return;
      try {
        const pixels = ctx.getImageData(0, 0, TILE_W, TILE_H);
        grayscaleRgba(pixels.data);
        ctx.putImageData(pixels, 0, 0);
      } catch {
        /* Холст «испачкан» чужим источником — кадр как есть. */
      }
    };
    image.onerror = () => alive && setSupported(false);
    image.src = url;
    return () => {
      alive = false;
    };
  }, [canvasRef, url, gray]);
  return supported;
}

/* Плитка кадра: холст (серый или цветной) или, где холста нет, сама картинка. */
export function SceneTile({ url, gray }) {
  const canvas = useRef(null);
  const supported = useSceneTile(canvas, url, gray);
  if (!supported)
    return url ? <img src={url} alt="" draggable={false} /> : <span />;
  return (
    <canvas ref={canvas} width={TILE_W} height={TILE_H} aria-hidden="true" />
  );
}
