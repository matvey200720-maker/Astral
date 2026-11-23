/*
 * Хранилище холстов студии (ТЗ 18.10.2026, Session 1, задача 6): пиксели
 * растровых слоёв, основы и масок живут не в документе (он — лёгкий JSON), а
 * здесь, под `id` слоя: у каждого слоя — холст размера документа. Масок
 * ключ — `mask:<id>`.
 *
 * Холсты — с `willReadFrequently`: кисть, штамп, коррекции и фильтры читают и
 * пишут куски пикселей (`getImageData` / `putImageData`) каждый мазок, а не
 * рисуют по ним; такой холст живёт в обычной памяти, чтение не сбрасывает
 * видеокарту.
 */

export const maskKey = (layerId) => `mask:${layerId}`;

/** Холст `width × height`: `OffscreenCanvas`, где он есть (рабочий поток), иначе — элемент страницы. */
export function createSurface(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  let canvas;
  if (typeof OffscreenCanvas === "function") canvas = new OffscreenCanvas(w, h);
  else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
  } else return null;
  let context = null;
  try {
    context = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    context = null;
  }
  return context ? { canvas, context, width: w, height: h } : null;
}

const clampRect = (rect, width, height) => {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
};
export { clampRect };

/**
 * Хранилище: `width × height` — размер документа. `get(id)` — поверхность
 * слоя (создаётся пустой, если её не было).
 */
export function createRasterStore(width, height) {
  const surfaces = new Map();
  const store = {
    width,
    height,
    get(id) {
      let surface = surfaces.get(id);
      if (!surface) {
        surface = createSurface(store.width, store.height);
        if (surface) surfaces.set(id, surface);
      }
      return surface;
    },
    has: (id) => surfaces.has(id),
    ids: () => [...surfaces.keys()],
    drop(id) {
      surfaces.delete(id);
    },
    /** Кусок пикселей слоя (копия): `Uint8ClampedArray`, `rect.width × rect.height × 4`. */
    read(id, rect) {
      const area = clampRect(rect, store.width, store.height);
      const surface = store.get(id);
      if (!area || !surface) return null;
      return { ...area, data: surface.context.getImageData(area.x, area.y, area.width, area.height).data };
    },
    /** Положить кусок пикселей на слой по месту `rect`. */
    write(id, rect, data) {
      const surface = store.get(id);
      if (!surface || !data) return;
      surface.context.putImageData(new ImageData(new Uint8ClampedArray(data), rect.width, rect.height), rect.x, rect.y);
    },
    clear(id, rect = null) {
      const surface = store.get(id);
      if (!surface) return;
      if (rect) surface.context.clearRect(rect.x, rect.y, rect.width, rect.height);
      else surface.context.clearRect(0, 0, store.width, store.height);
    },
    /** Слой целиком — картинкой (`ImageBitmap`, холст, `<img>`) на своё место `x, y`. */
    draw(id, source, x = 0, y = 0, width = null, height = null) {
      const surface = store.get(id);
      if (!surface) return;
      if (width && height) surface.context.drawImage(source, x, y, width, height);
      else surface.context.drawImage(source, x, y);
    },
    /** Копия слоя `from` под `to`. */
    copy(from, to) {
      const source = store.get(from);
      const target = store.get(to);
      if (source && target) {
        target.context.clearRect(0, 0, store.width, store.height);
        target.context.drawImage(source.canvas, 0, 0);
      }
    },
    /** Слои `top` склеены в `bottom` по режиму/непрозрачности (для «Склеить с нижним»). */
    mergeInto(bottom, top, { opacity = 1, operation = "source-over" } = {}) {
      const base = store.get(bottom);
      const over = store.get(top);
      if (!base || !over) return;
      base.context.save();
      base.context.globalAlpha = opacity;
      base.context.globalCompositeOperation = operation;
      base.context.drawImage(over.canvas, 0, 0);
      base.context.restore();
    },
    /** Холст стал другого размера: пиксели растягиваются (слои документа пересчитывает `resizeDocument`). */
    resize(nextWidth, nextHeight) {
      for (const [id, surface] of [...surfaces]) {
        const next = createSurface(nextWidth, nextHeight);
        if (!next) continue;
        next.context.imageSmoothingQuality = "high";
        next.context.drawImage(surface.canvas, 0, 0, nextWidth, nextHeight);
        surfaces.set(id, next);
      }
      store.width = nextWidth;
      store.height = nextHeight;
    },
    dispose() {
      surfaces.clear();
    },
  };
  return store;
}

/** Пиксели поверхности целиком (`ImageData`) — для мазка, что держит буфер весь мазок. */
export function readAll(surface) {
  return surface.context.getImageData(0, 0, surface.width, surface.height);
}
