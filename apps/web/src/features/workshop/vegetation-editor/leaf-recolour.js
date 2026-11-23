/*
 * Перекраска листов растительности вне главного потока (`leaf-recolour-worker.js`).
 *
 * `leafRecolourer().recolour(tag, baseKey, base, params)` → `Promise<Uint8ClampedArray | null>`: пиксели листа
 * `base` в облике `params` — те же, что дал бы `recolourLeafLevel` в окне. `null` — задание снято раньше, чем
 * потоку дошла очередь (`cancel`, или то же `tag` пришло снова): выжидающие правки не считаются зря.
 *
 * Очередь — в окне, а не в потоке: в потоке одновременно не больше двух заданий, остальные ждут здесь и снимаются
 * без следа. Потока нет (тесты, старый браузер) или он упал — лист считается тут же, по одному за такт, как до
 * 22.10.2026.
 */

import { recolourLeafLevel } from "@modovik/climb-contract/recolor/vegetation";

/* Заданий в потоке разом: пока одно считается, второе уже ждёт у него, а правка, что пришла позже, ещё снимаема. */
const IN_FLIGHT_LIMIT = 2;

const supported = () => typeof Worker === "function";

const localPixels = (job) => {
  const out = recolourLeafLevel(job.base.rgba, job.base.width, job.base.height, job.params);
  return out === job.base.rgba ? new Uint8ClampedArray(out) : out;
};

export function createLeafRecolourer({ makeWorker = null } = {}) {
  const create = makeWorker || (supported() ? () => new Worker(new URL("./leaf-recolour-worker.js", import.meta.url), { type: "module" }) : null);
  let worker = null;
  let dead = !create;
  let next = 1;
  /* Ждут очереди в окне / считаются в потоке. */
  let queue = [];
  const flying = new Map();
  /* Ключи, чьи исходные листы поток уже держит. */
  const known = new Set();

  function fallback(job) {
    flying.delete(job.id);
    job.resolve(localPixels(job));
  }

  function failAll() {
    known.clear();
    for (const job of [...flying.values()]) fallback(job);
  }

  function workerOf() {
    if (worker) return worker;
    worker = create();
    worker.onmessage = (event) => {
      const { id, rgba, error } = event.data || {};
      const job = flying.get(id);
      if (!job) return;
      if (error === "base") {
        /* Поток забыл исходный лист (вытеснен) — везём заново. */
        known.delete(job.key);
        flying.delete(id);
        send(job);
        return;
      }
      flying.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(rgba);
      pump();
    };
    worker.onerror = () => {
      dead = true;
      worker?.terminate?.();
      worker = null;
      failAll();
      pump();
    };
    return worker;
  }

  function send(job) {
    flying.set(job.id, job);
    try {
      const message = { id: job.id, key: job.key, params: job.params };
      /* Исходный лист — копией: окну он нужен для запасного пути и для нового цвета того же листа. */
      if (!known.has(job.key)) message.base = { rgba: new Uint8ClampedArray(job.base.rgba), width: job.base.width, height: job.base.height };
      workerOf().postMessage(message, message.base ? [message.base.rgba.buffer] : []);
      known.add(job.key);
    } catch {
      dead = true;
      worker = null;
      failAll();
    }
  }

  function pump() {
    while (queue.length && flying.size < (dead ? 1 : IN_FLIGHT_LIMIT)) {
      const job = queue.shift();
      if (dead) {
        /* Без потока — одно задание за такт: окно успевает рисовать между листами. */
        flying.set(job.id, job);
        setTimeout(() => {
          fallback(job);
          pump();
        }, 0);
      } else send(job);
    }
  }

  /**
   * `tag` — чьё это задание (одно и то же `tag` в очереди заменяется новым), `baseKey` — ключ исходного листа
   * (у листа игры — его адрес), `base` — `{ rgba, width, height }`, `params` — то, что берёт `recolourLeafLevel`.
   */
  function recolour(tag, baseKey, base, params) {
    return new Promise((resolve, reject) => {
      const replaced = queue.find((job) => job.tag === tag);
      if (replaced) {
        queue = queue.filter((job) => job !== replaced);
        replaced.resolve(null);
      }
      queue.push({ id: next++, tag, key: baseKey, base, params, resolve, reject });
      pump();
    });
  }

  /** Снять ждущие задания, чьё `tag` подходит (`keep(tag)` — оставить). Уже считающиеся доедут сами. */
  function cancel(keep) {
    const gone = queue.filter((job) => !keep(job.tag));
    queue = queue.filter((job) => keep(job.tag));
    for (const job of gone) job.resolve(null);
    return gone.length;
  }

  function dispose() {
    worker?.terminate?.();
    worker = null;
    for (const job of queue) job.resolve(null);
    queue = [];
    flying.clear();
    known.clear();
  }

  return { recolour, cancel, dispose, get pending() { return queue.length + flying.size; } };
}

/* Один на окно: листы не заводят каждый свой поток. */
let shared = null;
export const leafRecolourer = () => (shared ||= createLeafRecolourer());
