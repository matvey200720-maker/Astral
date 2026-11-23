/*
 * Где стоит главный поток (фикс 1 ТЗ 07.10.2026).
 *
 * Сторож (`main-watchdog.js`) замечает замирание только после него — по
 * опоздавшему таймеру — и знает лишь каналы окна, что были в работе. Если
 * же Windows закрыла зависшее окно, записи нет вовсе: 07.10 в 13:42 журнал
 * владельца оборвался на полуслове. Здесь — поток-наблюдатель: главный поток
 * отмечается в общей памяти на каждом такте сторожа, а наблюдатель, увидев,
 * что отметок нет дольше `stallMs`, снимает через инспектор профиль главного
 * потока и сразу пишет в журнал самый тяжёлый стек — пока поток ещё стоит.
 *
 * Наблюдатель спит, пока сторож не взведён (нет работы), и снимает один
 * профиль на одно замирание.
 */

import path from "node:path";
import { trackedWorker } from "./worker-census.js";
import { APP_LOG_FILE } from "./app-log.js";

const WORKER_URL = new URL("./main-stall-sampler-worker.js", import.meta.url);

/* Стек, который не забрал отчёт о стопе, уходит отдельным отчётом (`MainStallStack`) через это время. */
const STACK_ALONE_MS = 30_000;

/**
 * `{ arm(), beat(), disarm(), consumeStack(), close() }` — такты сторожа.
 * Порог стека — тот же, что у отчёта о стопе (2 с). `consumeStack(ms)` отдаёт
 * стек этого замирания отчёту о стопе: готовый — сразу, снимаемый — когда
 * снимется (не дольше `ms`), иначе `null`. Поток не поднялся — все вызовы пустые:
 * сторож работает, как прежде.
 */
export function createStallSampler({ userData, stallMs = 2000, sampleMs = 1500, workerUrl = WORKER_URL, logFile = null, onStack = null } = {}) {
  const shared = new SharedArrayBuffer(24);
  const flags = new Int32Array(shared, 0, 4);
  const times = new Float64Array(shared, 16, 1);
  let worker = null;
  /* Последний готовый стек и ожидающие отчёта о стопе. */
  let latest = null;
  const waiters = [];
  try {
    worker = trackedWorker("stall-sampler", workerUrl, {
      workerData: { shared, stallMs, sampleMs, userData, logFile: logFile || path.join(userData, APP_LOG_FILE) },
    });
    worker.unref();
    worker.on("error", () => {
      worker = null;
    });
    worker.on("message", (message) => {
      if (message?.type !== "stall") return;
      if (message.failed) {
        latest = null;
        for (const wake of waiters.splice(0)) wake(null);
        return;
      }
      const entry = { message, at: Date.now(), used: false };
      latest = entry;
      for (const wake of waiters.splice(0)) wake(entry);
      /* Стек не забрали за `STACK_ALONE_MS` — отчёт команде отдельно (20.10), как и раньше. */
      setTimeout(() => {
        if (entry.used) return;
        entry.used = true;
        try {
          onStack?.(message);
        } catch {
          /* Отчёт — дополнение к журналу. */
        }
      }, STACK_ALONE_MS).unref?.();
    });
  } catch {
    worker = null;
  }
  return {
    get alive() {
      return Boolean(worker);
    },
    beat() {
      times[0] = Date.now();
    },
    arm() {
      times[0] = Date.now();
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
    },
    disarm() {
      Atomics.store(flags, 0, 0);
      Atomics.notify(flags, 0);
    },
    /**
     * Стек замирания для отчёта о стопе: готовый — сразу, иначе ждёт, пока
     * рабочий поток его снимет (не дольше `ms`). `null` — стека не будет.
     * Ждёт и тогда, когда стек ещё не начат: отчёт о стопе идёт на первом
     * такте после разморозки, раньше сигнала рабочего потока.
     */
    consumeStack(ms = 4000) {
      if (latest && !latest.used && Date.now() - latest.at < STACK_ALONE_MS) {
        latest.used = true;
        return Promise.resolve(latest.message);
      }
      if (!worker) return Promise.resolve(null);
      return new Promise((resolve) => {
        const wake = (entry) => {
          clearTimeout(timer);
          if (entry) entry.used = true;
          resolve(entry ? entry.message : null);
        };
        const timer = setTimeout(() => {
          const at = waiters.indexOf(wake);
          if (at >= 0) waiters.splice(at, 1);
          resolve(null);
        }, ms);
        waiters.push(wake);
      });
    },
    async close() {
      await worker?.terminate().catch(() => {});
      worker = null;
    },
  };
}

/*
 * Самый тяжёлый стек профиля: лист с наибольшим собственным временем и
 * цепочка его вызовов. Служебные узлы (простой, сборщик) — только если
 * ничего другого нет.
 */
const SERVICE = new Set(["(idle)", "(program)", "(root)"]);

export function heaviestStack(profile, depth = 14) {
  const nodes = new Map((profile?.nodes || []).map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of nodes.values()) for (const child of node.children || []) parent.set(child, node.id);
  const self = new Map();
  const samples = profile?.samples || [];
  const deltas = profile?.timeDeltas || [];
  for (let index = 0; index < samples.length; index += 1) self.set(samples[index], (self.get(samples[index]) || 0) + (deltas[index] || 0));
  const total = [...self.values()].reduce((sum, value) => sum + value, 0);
  const ranked = [...self].filter(([id]) => nodes.has(id)).sort((a, b) => b[1] - a[1]);
  const pick = ranked.find(([id]) => !SERVICE.has(nodes.get(id).callFrame.functionName)) || ranked[0];
  if (!pick) return { top: "нет данных", text: "", share: 0 };
  const frameOf = (node) => {
    const { functionName, url, lineNumber } = node.callFrame;
    const where = url ? `${String(url).split(/[\\/]/).slice(-2).join("/")}:${lineNumber + 1}` : "";
    return `${functionName || "(анонимная)"}${where ? ` ${where}` : ""}`;
  };
  const lines = [];
  for (let id = pick[0], step = 0; id !== undefined && step < depth; id = parent.get(id), step += 1) {
    const node = nodes.get(id);
    if (!node || node.callFrame.functionName === "(root)") break;
    lines.push(frameOf(node));
  }
  return { top: lines[0] || "нет данных", text: lines.join("\n"), share: total ? pick[1] / total : 0 };
}
