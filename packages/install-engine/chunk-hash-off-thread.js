/*
 * Счёт хранилища кусков — в потоке (02.11.2026, второй проход «не грузить ЦП»). Замер
 * `scripts/perf/baseline/chunk-store-thread.mjs`: нарезка 1 ГБ (`cutFile`) держала главный
 * процесс 25 с, сборка копии из кусков (`thawFile`) — ещё ~2 с SHA-256; на update.rpf (2 ГБ)
 * холодная установка — до минуты занятого главного потока Electron.
 *
 * Главный поток по-прежнему читает и пишет файлы (потолки диска, «занято», отмена — как были),
 * а счёт идёт в потоке: байты лежат в общем буфере, поток считает и отвечает. Пока ответа нет,
 * главный поток буфер не трогает. Поток не поднялся (нет `worker_threads`, сборка без файла,
 * уже внутри потока) — `null`, и счёт идёт здесь же, как раньше.
 */
import { Worker, isMainThread } from "node:worker_threads";

const WORKER_URL = new URL("./chunk-hash-worker.js", import.meta.url);
/* Меньше этого — счёт здесь же: поток стоит своего запуска. */
export const HASHER_MIN_BYTES = 16 * 1024 * 1024;

/**
 * Поток счёта с общим буфером `bytes` байт или `null`. `buffer` — куда класть байты перед
 * вопросом; ответы приходят по порядку. `close()` — обязательно (в `finally`).
 */
export async function openChunkHasher(bytes, { workerUrl = WORKER_URL } = {}) {
  if (!isMainThread || process.env.ASTRAL_CHUNK_HASH_INLINE === "1") return null;
  const shared = new SharedArrayBuffer(bytes);
  let worker;
  try {
    worker = new Worker(workerUrl, { workerData: { shared } });
  } catch {
    return null;
  }
  const waiting = new Map();
  let nextId = 1;
  let failure = null;
  const failAll = (error) => {
    failure = failure || error;
    for (const { reject } of waiting.values()) reject(failure);
    waiting.clear();
  };
  worker.on("message", ({ id, value, error }) => {
    const job = waiting.get(id);
    if (!job) return;
    waiting.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(value);
  });
  worker.on("error", (error) => failAll(error));
  worker.on("exit", () => failAll(new Error("Поток счёта кусков закрылся.")));
  const ask = (op, extra = {}) =>
    failure
      ? Promise.reject(failure)
      : new Promise((resolve, reject) => {
          const id = nextId++;
          waiting.set(id, { resolve, reject });
          worker.postMessage({ id, op, ...extra });
        });
  /* Поток поднялся и загрузил свой модуль: иначе — счёт здесь же. */
  try {
    await ask("ping");
  } catch {
    await worker.terminate().catch(() => {});
    return null;
  }
  return {
    buffer: Buffer.from(shared),
    /** SHA-256 первых `length` байт буфера. */
    sha: (length) => ask("sha", { length }),
    /** Совпал ли кусок с `sha`; совпал и `feed` — его байты идут в отпечаток целого. */
    check: (length, sha, feed = false) => ask("check", { length, sha, feed }),
    /** Байты буфера — в отпечаток целого. */
    feed: (length) => ask("feed", { length }),
    /** Отпечаток целого (и новый счёт с нуля). */
    whole: () => ask("whole"),
    /** Нарезка: блок буфера → `{ ends, shas }` кусков, что в нём закончились; блок идёт и в отпечаток целого. */
    cut: (length) => ask("cut", { length }),
    /** Хеш недорезанного остатка или `null`. */
    cutEnd: () => ask("cutEnd"),
    close: async () => {
      failure = failure || new Error("Поток счёта кусков закрыт.");
      await worker.terminate().catch(() => {});
    },
  };
}
