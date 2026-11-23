import { styleRgba } from "@modovik/optimizer/texture-styles.js";
import { grayscaleRgba } from "@modovik/optimizer/texture-stages.js";

// Поток краски кадра «Стиля мира»: качает кадр, красит на своём холсте и отдаёт
// ImageBitmap, JPEG-Blob или data:-адрес. Сначала стиль мира, потом серый.

const fetchFrame = async (url) => {
  const reply = await fetch(url);
  return reply.ok
    ? createImageBitmap(await reply.blob())
    : Promise.reject(new Error(`frame ${reply.status}`));
};

// Кэш декодированных кадров по адресу: до шести, обращение освежает, самый старый
// вытесняется и закрывается, когда догрузился.
class FrameCache {
  static LIMIT = 6;

  #slots = new Map();

  #place(url, loading) {
    this.#slots.delete(url);
    this.#slots.set(url, loading);
    return loading;
  }

  #evictExtra() {
    for (const [url, loading] of this.#slots) {
      if (this.#slots.size <= FrameCache.LIMIT) break;
      this.#slots.delete(url);
      loading.then((bitmap) => bitmap?.close?.(), () => {});
    }
  }

  obtain(url) {
    const cached = this.#slots.get(url);
    if (cached !== undefined) return this.#place(url, cached);
    const loading = this.#place(url, fetchFrame(url));
    // неудачная загрузка уходит из кэша: следующая попытка качает заново
    loading.catch(() => {
      if (this.#slots.get(url) === loading) this.#slots.delete(url);
    });
    this.#evictExtra();
    return loading;
  }
}

const frames = new FrameCache();

const dataUrlOf = (blob) =>
  new Promise((resolve, reject) => {
    const reader = Object.assign(new FileReader(), {
      onload: () => resolve(reader.result),
      onerror: () => reject(reader.error),
    });
    reader.readAsDataURL(blob);
  });

const jpegOf = (canvas, quality) => canvas.convertToBlob({ type: "image/jpeg", quality });

// Как отдать холст: JPEG-Blob или data:-адрес; всё прочее — ImageBitmap.
const DELIVERIES = {
  blob: async (canvas, quality) => ({ blob: await jpegOf(canvas, quality) }),
  url: async (canvas, quality) => ({ url: await dataUrlOf(await jpegOf(canvas, quality)) }),
};

const deliver = (canvas, as, quality) =>
  Object.hasOwn(DELIVERIES, as)
    ? DELIVERIES[as](canvas, quality)
    : { bitmap: canvas.transferToImageBitmap() };

// Стиль мира, потом серый — на пикселях холста, на месте.
function repaintPixels(context, size, style, gray) {
  const [across, down] = size;
  const picture = context.getImageData(0, 0, across, down);
  if (style) styleRgba(picture.data, across, down, style);
  if (gray) grayscaleRgba(picture.data);
  context.putImageData(picture, 0, 0);
}

// Холст нужного размера с нарисованным кадром.
function drawnCanvas(frame, size, willReadFrequently) {
  const canvas = new OffscreenCanvas(...size);
  const context = canvas.getContext("2d", { willReadFrequently });
  if (!context) throw new Error("no 2d context");
  context.drawImage(frame, 0, 0, ...size);
  return { canvas, context };
}

export async function paintJob(job) {
  const { url, style, gray, as = "bitmap", quality = 0.86 } = job;
  const frame = await frames.obtain(url);
  const size = [job.width || frame.width, job.height || frame.height].map((side) =>
    Math.max(1, Math.round(side)),
  );
  const needsPixels = Boolean(style) || Boolean(gray);
  const { canvas, context } = drawnCanvas(frame, size, needsPixels);
  if (needsPixels) repaintPixels(context, size, style, gray);
  return deliver(canvas, as, quality);
}

// Ответ ровно один: успех (в том числе сбой самой отправки) или ошибка.
self.onmessage = async (event) => {
  const job = event.data ?? {};
  await paintJob(job)
    .then((result) =>
      self.postMessage({ id: job.id, ...result }, result.bitmap ? [result.bitmap] : []),
    )
    .catch((error) => self.postMessage({ id: job.id, error: String(error?.message || error) }));
};
