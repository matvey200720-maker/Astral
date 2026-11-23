/*
 * Холст предпросмотра: контекст, плотность пикселей, пиксели → холст.
 *
 * Помощники общие для всех студий. Жили они в `effects-preview.js` рядом с
 * генератором текстуры трассера, и каждый, кому нужен был просто холст, —
 * залазы, их обложка, — тянул вместе с ними весь генератор следа пули.
 * `effects-preview.js` по-прежнему отдаёт их тем же именем.
 */

/**
 * 2D-контекст холста или `null`.
 *
 * В среде без canvas (jsdom в тестах) `getContext` не возвращает `null`, а
 * бросает. Для сцены это не ошибка, а состояние «рисовать некуда»: редактор
 * обязан открыться и работать, просто без анимации.
 *
 * `options` — те же, что у `getContext`, и значат что-то только при первом
 * вызове на холсте: браузер запоминает их вместе с контекстом. Главное из них —
 * `willReadFrequently`. Обычный холст живёт в видеопамяти, и чтение из него
 * (`toDataURL`, `getImageData`) — синхронная выгрузка кадра с видеокарты:
 * 115–140 мс на плитку 96×96, пока видеокарта занята размытием и видео под
 * окном. Холст, из которого читают, заводится сразу в обычной памяти — то же
 * чтение стоит там десятые доли миллисекунды.
 */
export function context2d(canvas, options) {
  if (!canvas?.getContext) return null;
  try {
    return options ? canvas.getContext("2d", options) : canvas.getContext("2d");
  } catch {
    return null;
  }
}

/** Контекст холста, из которого будут читать пиксели: см. `context2d`. */
export const READBACK = Object.freeze({ willReadFrequently: true });

/**
 * Плотность пикселей, но не больше двойной.
 *
 * На трёхкратных экранах разница уже не видна, а площадь холста растёт вдвое —
 * и вместе с ней время каждого кадра.
 */
export const previewRatio = () =>
  Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);

/**
 * Размер холста, который лежит слоем в общем окне предпросмотра.
 *
 * Слой уже померен окном, и своего наблюдателя размера холсту не нужно: он
 * повторяет измеренный прямоугольник, умножая его на плотность пикселей. Два
 * наблюдателя за одной коробкой — это лишний круг перерисовок и значения,
 * разъезжающиеся на кадр.
 */
export function layerBitmap(layer) {
  const ratio = previewRatio();
  return {
    ratio,
    width: Math.max(1, Math.round((Number(layer?.width) || 0) * ratio)),
    height: Math.max(1, Math.round((Number(layer?.height) || 0) * ratio)),
  };
}

/** RGBA → холст. `null`, когда рисовать некуда. */
export function rgbaToCanvas(rgba, width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = context2d(canvas);
  if (!context) return null;
  const image = context.createImageData(width, height);
  image.data.set(rgba);
  context.putImageData(image, 0, 0);
  return canvas;
}
