/*
 * Поток картинок листов (опыт `bitmap-thread`, 16.11.2026): `Blob` из байтов WebP и `createImageBitmap` — не в главном потоке (`bitmap-thread.js`). Байты приходят переносом (без копии), картинка уходит обратно переносом.
 * Вызов `createImageBitmap` тот же, что у главного потока (`scene-textures.js: bitmapOfWebp`): без параметров или с `{ premultiplyAlpha: "none" }` — ровно один из двух, ничего не добавлено и не убрано.
 */

const describeFailure = (failure) => String(failure?.message || failure);

/**
 * Одна работа: `{ id, buffer, offset, length, straight }` → `{ reply, transfer }`. Зависимости подставляются тестом: `makeBlob(части, параметры)`, `makeBitmap(blob, параметры?)`.
 */
export async function decodeJob(message, deps = {}) {
  const { id, buffer, offset = 0, length, straight = false } = message || {};
  const makeBlob = deps.makeBlob || ((parts, options) => new Blob(parts, options));
  const makeBitmap = deps.makeBitmap || ((blob, options) => (options ? createImageBitmap(blob, options) : createImageBitmap(blob)));
  try {
    const bytes = new Uint8Array(buffer, offset, length ?? buffer.byteLength - offset);
    const bitmap = await makeBitmap(makeBlob([bytes], { type: "image/webp" }), straight ? { premultiplyAlpha: "none" } : undefined);
    return { reply: { id, bitmap }, transfer: [bitmap] };
  } catch (failure) {
    return { reply: { id, error: describeFailure(failure) }, transfer: [] };
  }
}

/* Настоящий поток: отвечает на работы и сообщает, умеет ли декодировать (в потоке без `createImageBitmap` байты остаются у главного потока). */
const scope = globalThis.WorkerGlobalScope;
if (typeof scope === "function" && typeof self !== "undefined" && self instanceof scope) {
  self.onmessage = async ({ data }) => {
    const { reply, transfer } = await decodeJob(data);
    self.postMessage(reply, transfer);
  };
  self.postMessage({ ready: true, decode: typeof createImageBitmap === "function" });
}
