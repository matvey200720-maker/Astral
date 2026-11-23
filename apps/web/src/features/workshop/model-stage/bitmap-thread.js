/*
 * Картинки листов в потоке (опыт `bitmap-thread`, 16.11.2026; `scene-textures.js: bitmapOfWebp`).
 *
 * Настоящий Electron, первый вход без замедления: `new Blob([bytes], { type: "image/webp" })` на главном потоке — Мегамолл 148 мс, Ангар 61 (профиль V8 входа): Blob копирует байты каждого из сотен листов,
 * и пачка ответов читателя делает это одной задачей. Здесь байты уходят в поток переносом (без копии: ответ читателя — отдельный `ArrayBuffer` на лист), Blob и `createImageBitmap` — там, готовая картинка
 * возвращается переносом. Пиксели те же: тот же вызов с теми же параметрами, что и в главном потоке (`bitmap-worker.js`), только в другом потоке.
 *
 * Откат без потерь: `decodeInThread` отвечает `undefined` ДО переноса байтов, если потока нет, он не умеет декодировать или не ответил (`READY_MS`) — вызывающий берёт главный поток. Поток упал уже ПОСЛЕ переноса —
 * байты ушли, `ThreadLost`: лист остаётся «ещё может приехать» (его спросят заново), а не «в игре нет».
 */

const READY_MS = 3000;

/** Поток пропал уже после того, как ему отдали байты. */
export class ThreadLost extends Error {
  constructor() {
    super("bitmap-thread-lost");
    this.name = "ThreadLost";
  }
}

const link = { thread: undefined, ready: null, settle: () => undefined, serial: 0, calls: new Map(), timer: 0 };
const isBuffer = (value) => value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]";

const deferred = () => {
  const call = {};
  call.promise = new Promise((resolve, reject) => Object.assign(call, { resolve, reject }));
  return call;
};

function deliver(reply) {
  const call = link.calls.get(reply.id);
  if (!call) return;
  link.calls.delete(reply.id);
  if (reply.error) call.reject(new Error(reply.error));
  else call.resolve(reply.bitmap);
}

/* Сбой потока: ждущие получают `ThreadLost`, потока больше нет (до конца окна — главный поток). */
function collapse() {
  for (const call of link.calls.values()) call.reject(new ThreadLost());
  link.calls.clear();
  clearTimeout(link.timer);
  link.settle(false);
  link.thread?.terminate?.();
  link.thread = null;
}

function openThread() {
  if (typeof Worker !== "function") return null;
  try {
    const ready = deferred();
    const thread = new Worker(new URL("./bitmap-worker.js", import.meta.url), { type: "module" });
    thread.onmessage = ({ data }) => {
      if (data?.ready) {
        clearTimeout(link.timer);
        /* Поток без `createImageBitmap` — как нет потока: байты остаются главному. */
        if (!data.decode) {
          link.thread = null;
          thread.terminate?.();
        }
        ready.resolve(Boolean(data.decode));
        return;
      }
      deliver(data || {});
    };
    thread.onerror = collapse;
    link.ready = ready.promise;
    link.settle = ready.resolve;
    link.timer = setTimeout(() => {
      /* Поток не ответил вовремя: не ждём его, байты остаются у главного потока. */
      if (link.thread === thread) {
        link.thread = null;
        thread.terminate?.();
      }
      ready.resolve(false);
    }, READY_MS);
    return thread;
  } catch {
    return null;
  }
}

const currentThread = () => (link.thread === undefined ? (link.thread = openThread()) : link.thread);

/**
 * Картинка из байтов WebP в потоке: `ImageBitmap`; `undefined` — потока нет, байты НЕ тронуты (вызывающий берёт главный поток); отказ декодера — ошибка, как у главного потока;
 * `ThreadLost` — поток упал с байтами. `bytes` — `ArrayBuffer` или его вид (`Uint8Array`), `straight` — прямая альфа (`premultiplyAlpha: "none"`).
 */
export async function decodeInThread(bytes, straight = false) {
  const thread = currentThread();
  if (!thread) return undefined;
  const usable = await link.ready;
  if (!usable || link.thread !== thread) return undefined;
  const buffer = isBuffer(bytes) ? bytes : bytes?.buffer;
  if (!isBuffer(buffer) || buffer.detached) return undefined;
  const id = ++link.serial;
  const call = deferred();
  link.calls.set(id, call);
  try {
    thread.postMessage({ id, buffer, offset: bytes.byteOffset || 0, length: bytes.byteLength, straight: Boolean(straight) }, [buffer]);
  } catch {
    /* Перенос не вышел — байты на месте (спецификация переносит после проверки). */
    link.calls.delete(id);
    return undefined;
  }
  return call.promise;
}

/** Закрыть поток и забыть связь: для тестов и выхода окна. */
export function closeBitmapThread() {
  clearTimeout(link.timer);
  for (const call of link.calls.values()) call.reject(new ThreadLost());
  link.calls.clear();
  link.thread?.terminate?.();
  link.thread = undefined;
  link.ready = null;
  link.settle = () => undefined;
}
