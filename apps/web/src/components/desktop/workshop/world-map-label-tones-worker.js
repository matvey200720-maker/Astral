// Поток замера цвета подписей большой карты. Рисует карту без подписей в холст
// (единица сцены на точку), читает пиксели и считает цвет подписей по фону.
// Ширины подписей меряет окно: шрифты окна потоку не видны.
import { labelTonesFromPixels, paintMapScene } from "@modovik/vector-map";

const CACHE_LIMIT = 8;

// «адрес|ШxВ» -> обещание картинки (или null при неудаче); порядок вставки = возраст
const decoded = new Map();

const pixelSize = (value) => Math.max(1, Math.round(value) || 0);

const closeBitmap = (bitmap) => bitmap?.close?.();

// Самая старая запись уходит, её картинка закрывается, когда декодирование закончилось.
const evictOldest = () => {
  if (decoded.size <= CACHE_LIMIT) return;
  const oldest = decoded.keys().next().value;
  const image = decoded.get(oldest);
  decoded.delete(oldest);
  image.then(closeBitmap);
  evictOldest();
};

const fetchBitmap = (href, width, height) =>
  new Promise((resolve) => resolve(fetch(href)))
    .then((response) => (response.ok ? response.blob() : null))
    .then(
      (blob) =>
        blob &&
        createImageBitmap(blob, {
          resizeWidth: pixelSize(width),
          resizeHeight: pixelSize(height),
          resizeQuality: "medium",
        }),
    )
    .catch(() => null);

const bitmapFor = (href, width, height) => {
  const key = `${href}|${pixelSize(width)}x${pixelSize(height)}`;
  if (!decoded.has(key)) {
    decoded.set(key, fetchBitmap(href, width, height));
    evictOldest();
  }
  return decoded.get(key);
};

// Размер картинки в точках холста: ширина, высота.
const scaledSize = (item, scale) => [
  Math.round(item.width * scale),
  Math.round(item.height * scale),
];

// Картинки берутся из ВСЕХ слоёв сцены, рисуются только слои из перечня.
const loadImages = async (scene, scale) => {
  const wanted = [...scene.layers]
    .flatMap((layer) => [...layer.items])
    .filter((item) => item.kind === "image" && item.href);
  const images = new Map();
  const reading = wanted.map((item) =>
    bitmapFor(item.href, ...scaledSize(item, scale)).then((bitmap) =>
      images.set(item.href, bitmap),
    ),
  );
  await Promise.all(reading);
  return images;
};

// Холст нужного размера и его 2d-контекст, рассчитанный на частое чтение пикселей.
const readableContext = (width, height) => {
  const context = new OffscreenCanvas(width, height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) throw new Error("нет контекста");
  return context;
};

const widthFrom = (widths) => (label) => widths[label.id] ?? null;

const measureTones = async ({ scene, labels, widths, scale, layers }) => {
  const [width, height] = [scene.width, scene.height].map((side) =>
    Math.max(1, Math.round(side * scale)),
  );
  const context = readableContext(width, height);

  const images = await loadImages(scene, scale);
  paintMapScene(context, scene, { width, height, images, layers });
  const pixels = context.getImageData(0, 0, width, height);
  return labelTonesFromPixels(labels, pixels, { scale, measure: widthFrom(widths) });
};

const platformReady = () =>
  [typeof OffscreenCanvas, typeof createImageBitmap].every((kind) => kind === "function");

self.onmessage = async (event) => {
  const job = event.data || {};
  const { id } = job;
  const work = platformReady() ? measureTones(job) : Promise.reject(new Error("нет платформы"));
  return work
    .then((tones) => self.postMessage({ id, tones }))
    .catch(() => self.postMessage({ id, failed: true }));
};
