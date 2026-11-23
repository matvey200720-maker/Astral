/*
 * Поток снимков плиток: разбор GLB, сборка шейдеров, кадр WebGL на `OffscreenCanvas` и кодирование в WebP — всё вне главного потока (31.10.2026, замер полки вещей мастерской
 * одежды на закрытой сборке ×4: плитка стоила ~150 мс главного потока — разбор, сборка, кадр, чтение холста `toBlob` и перерисовка; вся полка из 17 плиток шла 4 секунды и
 * держала прокрутку). Окну остаётся готовая картинка: `Blob` в хранилище и адрес.
 *
 * Сообщения окна: `{ type: "shoot", id, url, finish }` → `{ id, blob }` или `{ id, error: { kind, code, message } }`; `{ type: "warm", id, finish }` — собрать рендерер и программу простой
 * ткани заранее, ответ `{ id, ready: true }`; `{ type: "release" }` — отпустить контекст. `kind` ошибки: `model` — беда в самой модели (нет сцены, пустая, не разобралась), `engine` — нет
 * контекста или видеочипа в потоке: окно снимает дальше своим холстом (`model-thumbnail.js`).
 *
 * Контекст WebGL потока — второй на окно (первый — кадр студии на рендерере окна): как у холста снимков прежде, он отпускается без работы через `IDLE_MS`.
 */

import { THUMBNAIL_SIZE, ThumbnailFailure, createThumbnailRenderer, disposeThumbnailRenderer, shootModel, warmThumbnailRenderer } from "./model-thumbnail-core.js";

const IDLE_MS = 30_000;
let shared = null;
let idle = null;
let busy = 0;

class EngineFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "EngineFailure";
  }
}

function release() {
  idle = null;
  if (!shared || busy) return;
  try {
    disposeThumbnailRenderer(shared);
  } catch {
    /* контекст уже потерян */
  }
  shared = null;
}

function renderer() {
  clearTimeout(idle);
  if (shared) return shared;
  try {
    shared = createThumbnailRenderer(new OffscreenCanvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE));
  } catch (error) {
    throw new EngineFailure(String(error?.message || error));
  }
  return shared;
}

async function work(task) {
  busy += 1;
  try {
    return await task();
  } finally {
    busy -= 1;
    if (!busy) {
      clearTimeout(idle);
      idle = setTimeout(release, IDLE_MS);
    }
  }
}

const failure = (error) => {
  if (error instanceof ThumbnailFailure) return { kind: "model", code: error.code, message: error.message };
  if (error instanceof EngineFailure) return { kind: "engine", code: "engine", message: error.message };
  return { kind: "model", code: "load", message: String(error?.message || error) };
};

async function shoot({ url, finish }) {
  const mine = renderer();
  const shot = await shootModel(mine, url, finish, { alive: () => shared === mine });
  if (!shot) throw new EngineFailure("холст снимков отпустили посреди сборки");
  try {
    let blob = null;
    try {
      blob = await mine.canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
    } catch (error) {
      throw new EngineFailure(String(error?.message || error));
    }
    if (!blob) throw new EngineFailure("кадр не закодировался");
    return blob;
  } finally {
    shot.release();
  }
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "release") {
    release();
    return;
  }
  const { id } = message;
  try {
    if (message.type === "warm") {
      await work(async () => {
        const mine = renderer();
        await warmThumbnailRenderer(mine, message.finish || "cloth", () => shared === mine);
      });
      self.postMessage({ id, ready: true });
      return;
    }
    const blob = await work(() => shoot(message));
    self.postMessage({ id, blob });
  } catch (error) {
    self.postMessage({ id, error: failure(error) });
  }
};
