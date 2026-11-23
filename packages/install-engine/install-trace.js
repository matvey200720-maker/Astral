// Журнал фаз установки: привязан к ходу выполнения, звенья пакета отмечают себя сами.
import { AsyncLocalStorage } from "node:async_hooks";

const BYTES_IN_MEGABYTE = 1048576;

// Единственное хранилище «текущего журнала»; наружу — только две функции доступа.
const scope = (() => {
  const storage = new AsyncLocalStorage();
  return {
    enter: (trace, fn) => storage.run(trace, fn),
    current: () => storage.getStore(),
  };
})();

const performanceClock = () => performance.now();

class InstallTrace {
  #clock;
  #origin;
  #steps = [];
  // Map держит числовой и строковый ключ раздельно; в объект они сольются при finish().
  #notes = new Map();

  constructor(clock) {
    this.#clock = clock;
    this.#origin = clock();
  }

  step = (entry) => {
    this.#steps.push(entry);
  };

  note = (key, value) => {
    this.#notes.set(key, value);
  };

  finish = () => ({
    totalMs: this.#clock() - this.#origin,
    steps: [...this.#steps],
    notes: Object.fromEntries(this.#notes),
  });
}

export function createInstallTrace({ clock = performanceClock } = {}) {
  return new InstallTrace(clock);
}

export function withInstallTrace(trace, fn) {
  return scope.enter(trace, fn);
}

export function installTraceActive() {
  return scope.current() !== undefined;
}

export function traceNote(key, value) {
  const trace = scope.current();
  if (trace === undefined || trace === null) return;
  trace.note(key, value);
}

export function megabytes(bytes) {
  const fixed = (bytes / BYTES_IN_MEGABYTE).toFixed(1);
  return `${fixed.split(".").join(",")} МБ`;
}

// Замер шага по глобальному performance.now(): открывается до вызова, закрывается после. `at` — когда шаг начался (мс эпохи): по нему мерка диска
// (`scripts/perf/disk-busy-meter.mjs`) раскладывает секунды занятости по шагам.
function startMeasure(name) {
  const startedAt = performance.now();
  const at = Date.now();
  return () => ({ name, ms: performance.now() - startedAt, at });
}

const invoke = async (fn) => fn();

export function tracedStep(name, fn) {
  const trace = scope.current();
  if (trace === undefined || trace === null) return invoke(fn);

  const closeMeasure = startMeasure(name);
  // Запись шага идёт и после отказа; если журнал её не принял, ошибка подменяет результат.
  return invoke(fn).finally(() => trace.step(closeMeasure()));
}
