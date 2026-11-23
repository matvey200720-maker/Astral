/*
 * Картинки для предпросмотра эффектов.
 *
 * След пули окно рисует ровно той текстурой, которая уйдёт в игру: тот же
 * генератор, те же настройки. Ничего «похожего» и нарисованного отдельно у
 * следа нет — иначе человек настраивал бы одно, а получал другое.
 *
 * Эффекты попадания живут иначе: их вид в игре задаёт не текстура, а правило
 * частиц штатного эффекта, и окно показывает его поведение схемой — см.
 * `impact-sim.js`. Здесь от них остались только общие помощники холста.
 */

import { renderTracerTexture } from "@modovik/ptfx-studio";
import { ASTRAL_TRACER_TEXTURE_LAYOUT } from "@modovik/tracer-contract";
import {
  context2d,
  previewRatio,
  READBACK,
  rgbaToCanvas,
} from "./canvas-surface.js";
import { createLruCache } from "./lru-cache.js";

export const PREVIEW_TRACER = Object.freeze({
  width: ASTRAL_TRACER_TEXTURE_LAYOUT.width,
  height: ASTRAL_TRACER_TEXTURE_LAYOUT.height,
});

/* Помощники холста живут в `canvas-surface.js`: они нужны и тем, кому
   генератор следа пули ни к чему. Здесь — те же имена для прежних импортов. */
export {
  context2d,
  layerBitmap,
  previewRatio,
  READBACK,
  rgbaToCanvas,
} from "./canvas-surface.js";

/*
 * Цвета трассера: список (один или переход) и режим. Трассер прежних схем
 * (один `colour`) читается так же — обложки старых работ рисуются им.
 */
const tracerColours = (tracer) =>
  Array.isArray(tracer?.colours) && tracer.colours.length
    ? tracer.colours
    : [tracer?.colour || "#ff7a1a"];

/*
 * Уменьшенная текстура — для плиток выбора вида.
 *
 * Плитка показывает след в 22×44 точки, а полная текстура — 128×256: считать
 * её ради плитки значило платить за 32 тысячи пикселей там, где видно полторы.
 * Генератор от разрешения не зависит (шум у него на своей решётке), поэтому
 * маленькая текстура — это та же картинка, а не «похожая».
 */
export const TRACER_TILE = Object.freeze({ width: 48, height: 96 });

/*
 * Пиксели текстуры по её настройкам.
 *
 * Ползунок цвета или свечения проходит по одним и тем же значениям туда и
 * обратно, а шесть плиток видов при каждом шаге просят шесть текстур сразу.
 * Посчитанное держится по ключу настроек; предел — чтобы долгий сеанс с
 * палитрой не копил их без счёта.
 */
const textureCache = createLruCache(96);

export function tracerTextureRGBA(tracer, size = PREVIEW_TRACER) {
  const key = `${tracerTextureKey(tracer)}|${size.width}x${size.height}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  return textureCache.set(
    key,
    renderTracerTexture({
      width: size.width,
      height: size.height,
      style: tracer.style,
      colours: tracerColours(tracer),
      colourMode: tracer.colourMode || "solid",
      coreColour: tracer.coreColour,
      glow: tracer.glow,
    }),
  );
}

/**
 * Текстура прямо в данный холст — без PNG посередине.
 *
 * Плитки раньше получали картинку через `toDataURL`: сжать в PNG, закодировать
 * в base64 и отдать браузеру распаковывать обратно. На шести плитках и уголке
 * слота это две трети времени каждого шага ползунка — 60–90 мс, то есть 11
 * кадров в секунду вместо 60. Холст принимает пиксели как есть.
 */
export function drawTracerTexture(canvas, tracer, size = PREVIEW_TRACER) {
  const context = context2d(canvas);
  if (!context) return false;
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
  const image = context.createImageData(size.width, size.height);
  image.data.set(tracerTextureRGBA(tracer, size));
  context.putImageData(image, 0, 0);
  return true;
}

/** Холст со следом пули по настройкам трассера. */
export function tracerPreviewCanvas(tracer) {
  return rgbaToCanvas(
    tracerTextureRGBA(tracer),
    PREVIEW_TRACER.width,
    PREVIEW_TRACER.height,
  );
}

/**
 * Ключ настроек.
 *
 * Пересчитывать текстуру нужно только когда поменялось то, что на неё влияет.
 * Выбранное оружие на картинку не влияет — и не должно заставлять её
 * перерисовываться на каждый щелчок. Толщина и длина тоже: они правят размер
 * спрайта в игре, а не пиксели.
 */
export const tracerTextureKey = (tracer) =>
  [
    tracer.style,
    tracerColours(tracer).join(","),
    tracer.colourMode || "solid",
    tracer.coreColour,
    tracer.glow,
  ].join("|");

/**
 * Цвет головы следа — им светится попадание на стрельбище и метка трассера
 * в списке. У радуги голова красная: спектр идёт от красного.
 */
export const tracerHeadColour = (tracer) =>
  tracer?.colourMode === "rainbow" ? "#ff2a2a" : tracerColours(tracer)[0];

const streakCache = new Map();

/**
 * Миниатюра следа для списка трассеров: та же текстура, положенная набок,
 * головой вправо, на тёмной подложке. Кэш по ключу текстуры и размеру —
 * список перерисовывается на каждое движение ползунка.
 */
export function tracerStreakThumb(tracer, { width = 72, height = 22 } = {}) {
  const key = `${tracerTextureKey(tracer)}|${width}x${height}`;
  if (streakCache.has(key)) return streakCache.get(key);
  if (streakCache.size > 64) streakCache.clear();
  const texture = tracerPreviewCanvas(tracer);
  if (!texture || typeof document === "undefined") return null;
  const ratio = previewRatio();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  /* Миниатюра сжимается в PNG — из холста читают: см. `context2d`. */
  const context = context2d(canvas, READBACK);
  if (!context) return null;
  context.scale(ratio, ratio);
  context.fillStyle = "#08090c";
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "lighter";
  /* Текстура вертикальная (голова сверху): набок, головой вправо. */
  const thickness = height * 0.9;
  context.translate(width - 2, height / 2 - thickness / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(texture, 0, 0, thickness, width - 4);
  const url = canvas.toDataURL("image/png");
  streakCache.set(key, url);
  return url;
}
