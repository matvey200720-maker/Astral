// Исполнитель векторной подложки: рисует в одном фоновом потоке на всё приложение,
// а если потока нет или он упал — тем же кодом в окне (без рисования на процессоре).
import { canvasBlob, paintVectorCanvas, VECTOR_GEOMETRY_KEEP } from "./world-map-vector-render.js";
import { perfTimedAsync } from "../../../perf-count.js";

const DEFAULT_IDLE_MS = 60000;
const DEFAULT_KIND = "radar";
// Поля группы геометрии, которые уезжают в поток (в этом порядке).
const GROUP_FIELDS = Object.freeze(["role", "depth", "color", "alpha", "height", "positions"]);

// Рисование в окне: запасной путь. Источник null даёт отказ платформы (не исключение).
const paintInWindow = async (source, rect, width, height, sea) => {
  const canvas = paintVectorCanvas(source, rect, width, height, sea);
  return canvas ? canvasBlob(canvas) : null;
};

// Сообщение «геометрия»: только нужные поля групп, positions — тот же массив.
const geometryMessage = (key, geometry) => ({
  type: "geometry",
  key,
  geometry: {
    kind: geometry.kind || DEFAULT_KIND,
    groups: geometry.groups.map((group) =>
      Object.fromEntries(GROUP_FIELDS.map((field) => [field, group[field]])),
    ),
  },
});

const once = (action) => {
  let spent = false;
  return () => {
    if (spent) return;
    spent = true;
    action();
  };
};

// Состояние потока: живой поток, сон по простою, ничего (нет или упал).
class BackgroundPainter {
  constructor(idleMs) {
    this.idleMs = idleMs;
    this.worker = null;
    this.sleeping = false;
    this.holds = 0;
    this.timer = null;
    this.jobCount = 0;
    this.geometryCount = 0;
    this.keys = new WeakMap(); // объект геометрии -> "gN"
    this.delivered = new Set(); // ключи, уехавшие в текущий поток, по порядку добавления
    this.pending = new Map(); // id -> { resolve, reject, args }
    this.spawn();
    this.armTimer();
  }

  get threaded() {
    return this.worker !== null || this.sleeping;
  }

  stopTimer() {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  armTimer() {
    this.stopTimer();
    const quiet = this.worker && this.holds === 0 && this.pending.size === 0;
    if (quiet) this.timer = setTimeout(() => this.goToSleep(), this.idleMs);
  }

  goToSleep() {
    this.timer = null;
    if (!this.worker || this.pending.size > 0) return;
    this.worker.terminate();
    Object.assign(this, { worker: null, sleeping: true });
    this.delivered.clear();
  }

  spawn() {
    this.worker = null;
    if (typeof Worker !== "function") return;
    try {
      const born = new Worker(new URL("./world-map-vector-worker.js", import.meta.url), {
        type: "module",
      });
      born.onmessage = (event) => this.onAnswer(event);
      born.onerror = (event) => this.onCrash(born, event);
      this.worker = born;
    } catch {
      this.worker = null;
    }
  }

  wakeUp() {
    this.sleeping = false;
    this.spawn();
  }

  onAnswer(event) {
    const { id, error, blob } = event.data || {};
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (error) entry.reject(new Error(error));
    else entry.resolve(blob || null);
    this.armTimer();
  }

  // Поток упал: он закрывается навсегда, а ждавшие задания дорисовываются в окне.
  onCrash(born, event) {
    event.preventDefault?.();
    if (this.worker !== born) return;
    born.terminate();
    this.worker = null;
    this.stopTimer();
    const orphans = [...this.pending.values()];
    this.pending.clear();
    orphans.forEach(({ args, resolve, reject }) => paintInWindow(...args).then(resolve, reject));
  }

  keyFor(geometry) {
    if (!this.keys.has(geometry)) {
      this.geometryCount += 1;
      this.keys.set(geometry, `g${this.geometryCount}`);
    }
    return this.keys.get(geometry);
  }

  deliver(key, geometry) {
    if (this.delivered.has(key)) return;
    this.worker.postMessage(geometryMessage(key, geometry));
    this.delivered.add(key);
    const surplus = Math.max(0, this.delivered.size - VECTOR_GEOMETRY_KEEP);
    [...this.delivered].slice(0, surplus).forEach((oldest) => this.delivered.delete(oldest));
  }

  renderJob(source, rect, width, height, sea, cpu) {
    if (this.sleeping) this.wakeUp();
    this.stopTimer();
    const args = [source, rect, width, height, sea];
    const geometry = source?.geometry;
    if (!this.worker || !geometry) return paintInWindow(...args);

    let key;
    try {
      key = this.keyFor(geometry);
      this.deliver(key, geometry);
    } catch {
      this.armTimer();
      return paintInWindow(...args);
    }

    return new Promise((resolve, reject) => {
      this.jobCount += 1;
      const id = this.jobCount;
      this.pending.set(id, { resolve, reject, args });
      const { atlas, base, pass } = source;
      const job = { key, atlas, base, pass, rect, width, height, sea, cpu };
      try {
        this.worker.postMessage({ id, type: "render", job });
      } catch {
        this.pending.delete(id);
        this.armTimer();
        paintInWindow(...args).then(resolve, reject);
      }
    });
  }

  render(source, rect, width, height, sea, cpu) {
    const counter = cpu ? "map.vector.cpu" : "map.vector.gpu";
    return perfTimedAsync(counter, () => this.renderJob(source, rect, width, height, sea, cpu));
  }

  hold() {
    this.holds += 1;
    this.stopTimer();
    if (this.sleeping) this.wakeUp();
    return once(() => {
      this.holds -= 1;
      this.armTimer();
    });
  }
}

const createVectorRunner = ({ idleMs = DEFAULT_IDLE_MS } = {}) => {
  const painter = new BackgroundPainter(idleMs);
  return {
    hold() {
      return painter.hold();
    },
    get threaded() {
      return painter.threaded;
    },
    render(source, rect, width, height, sea = null, { cpu = false } = {}) {
      return painter.render(source, rect, width, height, sea, cpu);
    },
    renderJob(source, rect, width, height, sea = null, { cpu = false } = {}) {
      return painter.renderJob(source, rect, width, height, sea, cpu);
    },
  };
};

let sharedRunner = null;

// Общий исполнитель приложения: создаётся при первом вызове.
const vectorRunner = () => {
  sharedRunner ??= createVectorRunner();
  return sharedRunner;
};

export { createVectorRunner, vectorRunner };
