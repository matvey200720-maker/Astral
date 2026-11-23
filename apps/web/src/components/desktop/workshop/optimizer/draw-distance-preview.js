/*
 * Кадр вкладки «Дальность прорисовки» — настоящие кадры из игры с одной
 * высокой точки, по кадру на ступень дальности (`DRAW_DISTANCE_STOPS`) и
 * кадр «Как в игре» (задача 7 ТЗ 06.10.2026).
 *
 * На каждой ступени снято два кадра: с чёрной стеной и с белой. Туман игры
 * — смесь цвета мира и цвета тумана: чёрная стена даёт «мир × (1 − туман)»,
 * белая — то же плюс «туман». Разница кадров — доля тумана в каждой точке,
 * поэтому свой цвет стены считается из них без нового кадра:
 * `чёрный + доля × цвет`. Сплошная белая стена в кадре — 248, а не 255
 * (тон-кривая игры), доля считается от неё. Свой цвет установщик кладёт «с
 * запасом под кривую» (`fogChannel`), и днём стена выходит того цвета, что
 * выбран, — им кадр и красит. Чернота и белый — сами кадры, без расчёта;
 * подпись под кадром говорит, где цвет посчитан.
 *
 * Кадры лежат в `src/assets/draw-distance/`: `stock.jpg`,
 * `<дальность>-black.jpg`, `<дальность>-white.jpg`. Каких нет — сборка знает
 * сама (`import.meta.glob`), окно не стучится за ними.
 */

import { useEffect, useState } from "react";
import { drawDistanceStop, normalizeDrawDistance } from "@modovik/optimizer/draw-distance.js";

const SHOTS = import.meta.glob("../../../../assets/draw-distance/*.{jpg,png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Адрес кадра или `null`. */
export function drawDistanceShotUrl(file) {
  for (const extension of ["jpg", "png", "webp"]) {
    const url = SHOTS[`../../../../assets/draw-distance/${file}.${extension}`];
    if (url) return url;
  }
  return null;
}

/** Какие кадры нужны настройкам: `{ kind, files }`. */
export function drawDistanceShots(input) {
  const { distance, look } = normalizeDrawDistance(input);
  if (distance === null) return { kind: "stock", files: ["stock"] };
  const stop = drawDistanceStop(distance);
  if (look.colour === "#000000") return { kind: "black", stop, files: [`${stop}-black`] };
  if (look.colour === "#ffffff") return { kind: "white", stop, files: [`${stop}-white`] };
  return { kind: "custom", stop, files: [`${stop}-black`, `${stop}-white`] };
}

const pixels = new Map();
export async function imagePixels(url, width, height) {
  const key = `${url}@${width}x${height}`;
  if (!pixels.has(key))
    pixels.set(
      key,
      (async () => {
        const response = await fetch(url);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close?.();
        return context.getImageData(0, 0, width, height).data;
      })().catch((error) => {
        pixels.delete(key);
        throw error;
      }),
    );
  return pixels.get(key);
}

const channels = (hex) => {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/* Сплошная белая стена в кадре игры (полдень, тон-кривая): 248 из 255. */
const WHITE_WALL = 248;

/** Свой цвет стены по кадрам с чёрной и белой стеной (RGBA, та же длина). */
export function composeWall(black, white, look) {
  const out = new Uint8ClampedArray(black.length);
  const colour = channels(look.colour);
  for (let at = 0; at < black.length; at += 4) {
    const fog = Math.min(1, Math.max(0, (white[at] - black[at] + white[at + 1] - black[at + 1] + white[at + 2] - black[at + 2]) / (3 * WHITE_WALL)));
    /* Чёрный кадр — уже «мир × (1 − туман)»: остаётся прибавить туман цветом. */
    for (let channel = 0; channel < 3; channel += 1) out[at + channel] = black[at + channel] + fog * colour[channel];
    out[at + 3] = 255;
  }
  return out;
}

/**
 * Рисует кадр настроек в холст. `{ supported, missing }`: `missing` — имена
 * кадров, которых в сборке нет (вкладка пишет «кадр ещё не снят»).
 */
export function useDrawDistancePreview(canvasRef, settings, { width = 1280, height = 720 } = {}) {
  const shots = drawDistanceShots(settings);
  const key = JSON.stringify([shots.files, normalizeDrawDistance(settings).look]);
  const missing = shots.files.filter((file) => !drawDistanceShotUrl(file));
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.("2d");
    if (!canvas || !context || typeof createImageBitmap !== "function") {
      setSupported(false);
      return undefined;
    }
    if (missing.length) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const urls = shots.files.map(drawDistanceShotUrl);
      const data = await Promise.all(urls.map((url) => imagePixels(url, width, height)));
      if (cancelled) return;
      const rgba = shots.kind === "custom" ? composeWall(data[0], data[1], normalizeDrawDistance(settings).look) : data[0];
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    })().catch(() => {
      if (!cancelled) setSupported(false);
    });
    return () => {
      cancelled = true;
    };
    // Кадр перерисовывается ключом кадров и цвета, а не каждой новой работой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width, height]);
  return { supported, missing, kind: shots.kind, stop: shots.stop ?? null };
}

/**
 * Картинка стены «Свой цвет» для плитки плёнки и карточки стены: тот же расчёт, что у кадра сцены (`composeWall`), но на маленьком холсте
 * — по паре кадров с чёрной и белой стеной. Чернота и «Белый» — сами кадры, их рисует `<img>` без расчёта. Возвращает `false`, если
 * кадров нет или холста нет (тогда вкладка рисует пустое место).
 */
export function useCustomWallPicture(canvasRef, stop, colour, width, height, enabled) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.("2d");
    const black = drawDistanceShotUrl(`${stop}-black`);
    const white = drawDistanceShotUrl(`${stop}-white`);
    if (!canvas || !context || !black || !white || typeof createImageBitmap !== "function") {
      setFailed(true);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const [darkPixels, lightPixels] = await Promise.all([imagePixels(black, width, height), imagePixels(white, width, height)]);
      if (cancelled) return;
      context.putImageData(new ImageData(new Uint8ClampedArray(composeWall(darkPixels, lightPixels, { colour })), width, height), 0, 0);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [canvasRef, stop, colour, width, height, enabled]);
  return !failed;
}
