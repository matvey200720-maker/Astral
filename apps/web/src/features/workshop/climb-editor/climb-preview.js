/*
 * Кадры редактора залазов: сама текстура на шахматке и свет времени суток.
 *
 * Метку рисует `climb-render.js` — те же пиксели, что уедут в DDS. Кадр «На месте» — настоящий кусок
 * карты с метками на своих местах (`ClimbPlaces.jsx`); здесь от него только свет времени суток. Настоящих
 * текстур игры в поставке нет и не будет (см. `@modovik/gta-preview-assets`): подпись под кадром говорит
 * об этом прямо.
 */

import {
  context2d,
  previewRatio,
} from "../../../components/desktop/workshop/canvas-surface.js";

/** Условия просмотра: не настройка залаза, а время суток за окном. */
export const CLIMB_SCENES = Object.freeze([
  Object.freeze({ id: "day", label: "День" }),
  Object.freeze({ id: "dusk", label: "Сумерки" }),
  Object.freeze({ id: "night", label: "Ночь" }),
]);

/** Свет времени суток: темнота крашеной метки (`shade`) и яркость свечения (`bloom`). */
export const CLIMB_SCENE_LIGHT = Object.freeze({
  day: { shade: 0.1, bloom: 0.15 },
  dusk: { shade: 0.28, bloom: 0.55 },
  night: { shade: 0.46, bloom: 1 },
});

function fitCanvas(canvas, fallbackWidth, fallbackHeight) {
  const context = context2d(canvas);
  if (!context) return null;
  const ratio = previewRatio();
  const width = Math.max(
    1,
    Math.round((canvas.clientWidth || fallbackWidth) * ratio),
  );
  const height = Math.max(
    1,
    Math.round((canvas.clientHeight || fallbackHeight) * ratio),
  );
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

/**
 * Кадр «сама текстура».
 *
 * Шахматка под слоем — не украшение: у метки прозрачный фон, и без неё
 * нельзя отличить «прозрачно» от «залито чёрным», а это две очень разные
 * текстуры.
 */
export function paintClimbTexture(canvas, { marker } = {}) {
  const frame = fitCanvas(canvas, 320, 320);
  if (!frame) return false;
  const { context, width, height } = frame;
  const cell = Math.max(6, Math.round(Math.min(width, height) / 24));
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const even = ((x / cell) | 0) % 2 === ((y / cell) | 0) % 2;
      context.fillStyle = even ? "#1c2029" : "#141821";
      context.fillRect(x, y, cell, cell);
    }
  }
  if (marker) {
    const scale = Math.min(
      (width * 0.92) / marker.width,
      (height * 0.92) / marker.height,
    );
    const drawWidth = marker.width * scale;
    const drawHeight = marker.height * scale;
    context.imageSmoothingEnabled = scale < 1;
    context.drawImage(
      marker,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  }
  return true;
}
