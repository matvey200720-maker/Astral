import os from "node:os";
import { appLog } from "./app-log.js";
import { workerCensusLine } from "./worker-census.js";

const IDLE_CPU = 2;
const IDLE_MS = 300_000;
const KB_PER_MB = 1024;
const BYTES_PER_MB = 1024 * 1024;
const NOTHING_RUNNING = "ничего из мастерской";

// Куда в сводке попадает память процесса каждого вида; всё незнакомое — «служебные».
const MEMORY_SLOT = new Map([
  ["Browser", "main"],
  ["Tab", "window"],
  ["GPU", "gpu"],
]);
const SLOTS = ["main", "window", "gpu", "other"];

const numeric = (value) => Number(value) || 0;
const tenths = (value) => Math.round(value * 10) / 10;
const wholeSeconds = (ms) => Math.max(1, Math.round(ms / 1000));

// Накопитель сводки процессов: память по слотам в МБ (округление у каждого процесса своё) и процессор.
class Tally {
  memory = { main: 0, window: 0, gpu: 0, other: 0 };
  cpu = 0;

  take(metric) {
    const slot = MEMORY_SLOT.get(metric.type) ?? "other";
    this.memory[slot] += Math.round(numeric(metric.memory?.workingSetSize) / KB_PER_MB);
    this.cpu += numeric(metric.cpu?.percentCPUUsage);
  }

  finish(cores) {
    return { memory: this.memory, cpu: tenths(this.cpu / Math.max(1, cores)) };
  }
}

export const summarizeMetrics = (metrics = [], cores = 1) => {
  const tally = new Tally();
  for (const metric of metrics) tally.take(metric);
  return tally.finish(cores);
};

function describeMemory({ main, window, gpu, other }) {
  const extra = other ? `, служебные ${other} МБ` : "";
  return `главный ${main} МБ, окно ${window} МБ, видеочип ${gpu} МБ${extra}`;
}

// Разбор памяти главного процесса; пустая строка, если прочесть не удалось.
function describeMainHeap(memoryUsage) {
  try {
    const usage = memoryUsage();
    const inMb = (field) => Math.round(Number(usage?.[field] ?? 0) / BYTES_PER_MB);
    const heap = `${inMb("heapUsed")} из ${inMb("heapTotal")}`;
    return `куча JS главного ${heap} МБ, буферы ${inMb("external")} МБ`;
  } catch {
    return "";
  }
}

// Пики за промежуток: память по слотам начинается с первого снимка, процессор — с нуля.
class Peak {
  constructor(first) {
    this.memory = { ...first.memory };
    this.cpu = 0;
  }

  raise(snapshot) {
    for (const slot of SLOTS) this.memory[slot] = Math.max(this.memory[slot], snapshot.memory[slot]);
    this.cpu = Math.max(this.cpu, snapshot.cpu);
  }
}

// Всплеск: промежуток повышенной нагрузки, одной строкой в конце.
class Surge {
  constructor(startedAt, first) {
    this.startedAt = startedAt;
    this.peak = new Peak(first);
    this.titles = new Set();
  }

  track(snapshot) {
    this.peak.raise(snapshot);
  }

  name(title) {
    this.titles.add(String(title || ""));
  }

  report(endedAt) {
    const titles = [...this.titles].filter(Boolean).join(", ") || NOTHING_RUNNING;
    const seconds = wholeSeconds(endedAt - this.startedAt);
    const memory = describeMemory(this.peak.memory);
    return `Всплеск ${seconds} с: процессор до ${this.peak.cpu} %, ${memory}; шло: ${titles}`;
  }
}

// Окно сводки: копит снимки до следующей записи «За N мин».
class SummaryWindow {
  constructor(startedAt, first) {
    this.startedAt = startedAt;
    this.peak = new Peak(first);
    this.count = 0;
    this.cpuTotal = 0;
  }

  add(snapshot) {
    this.count += 1;
    this.cpuTotal += snapshot.cpu;
    this.peak.raise(snapshot);
  }

  report(endedAt, snapshot, heap) {
    const minutes = Math.round((endedAt - this.startedAt) / 60_000);
    const average = tenths(this.cpuTotal / this.count);
    const lines = [
      `За ${minutes} мин: процессор в среднем ${average} %, пик ${this.peak.cpu} %`,
      `сейчас ${describeMemory(snapshot.memory)}`,
      `пик ${describeMemory(this.peak.memory)}`,
    ];
    if (heap) lines.push(heap);
    return lines.join("; ");
  }
}

class ResourceMonitor {
  #cfg;
  #watchers;
  #timer = null;
  #last = null;
  #surge = null;
  #summary = null;
  #firstTickAt = null;
  #startupLogged = false;
  #idleSince = null;
  #idleLogged = false;

  constructor(cfg) {
    this.#cfg = cfg;
    this.#watchers = [this.#watchSurge, this.#watchStartup, this.#watchIdle, this.#watchSummary];
  }

  // Журнал: сначала ищется log.record, потом строится текст, потом вызов.
  #record = (source, build) => {
    const { log } = this.#cfg;
    log.record({ level: "info", source, message: build() });
  };

  #measure() {
    const { app, cores } = this.#cfg;
    return summarizeMetrics(app.getAppMetrics?.() || [], cores);
  }

  #capture() {
    const { now } = this.#cfg;
    return { at: now(), snapshot: this.#measure() };
  }

  #watchSurge = ({ at, snapshot }) => {
    const { cpuSpike, memorySpikeMb, intervalMs, describeWork } = this.#cfg;
    const before = this.#last;
    const grew = (slot) => before !== null && snapshot.memory[slot] - before.snapshot.memory[slot] >= memorySpikeMb;
    if (snapshot.cpu >= cpuSpike || grew("window") || grew("gpu")) {
      this.#surge ??= new Surge(before ? at - intervalMs : at, snapshot);
      this.#surge.track(snapshot);
      this.#surge.name(describeWork());
    } else if (this.#surge !== null) {
      const ended = this.#surge;
      this.#record("resources", () => ended.report(at));
      this.#surge = null;
    }
  };

  #watchStartup = ({ at }) => {
    const { intervalMs } = this.#cfg;
    this.#firstTickAt ??= at;
    if (!this.#startupLogged && at - this.#firstTickAt >= intervalMs) {
      this.#startupLogged = true;
      this.#record("workers", () => `потоки при старте: ${workerCensusLine()}`);
    }
  };

  #watchIdle = ({ at, snapshot }) => {
    if (this.#surge !== null || !(snapshot.cpu < IDLE_CPU)) {
      this.#idleSince = null;
      this.#idleLogged = false;
      return;
    }
    this.#idleSince ??= at;
    if (!this.#idleLogged && at - this.#idleSince >= IDLE_MS) {
      this.#idleLogged = true;
      this.#record("workers", () => `простой 5 мин: потоки ${workerCensusLine()}`);
    }
  };

  #watchSummary = ({ at, snapshot }) => {
    const { summaryMs, memoryUsage } = this.#cfg;
    this.#summary ??= new SummaryWindow(at, snapshot);
    const window = this.#summary;
    window.add(snapshot);
    if (at - window.startedAt >= summaryMs) {
      const heap = describeMainHeap(memoryUsage);
      this.#record("resources", () => window.report(at, snapshot, heap));
      this.#summary = null;
    }
  };

  tick = () => {
    const frame = this.#capture();
    for (const watch of this.#watchers) watch(frame);
    this.#last = frame;
  };

  start = () => {
    if (this.#timer) return;
    const { timers, intervalMs } = this.#cfg;
    const handle = timers.setInterval(this.tick, intervalMs);
    this.#timer = handle;
    handle.unref?.();
  };

  stop = () => {
    const { timers, now } = this.#cfg;
    if (this.#timer) {
      timers.clearInterval(this.#timer);
      this.#timer = null;
    }
    const at = now();
    const ended = this.#surge;
    if (ended === null) return;
    this.#record("resources", () => ended.report(at));
    this.#surge = null;
  };

  note = (reason) => {
    const { now, memoryUsage, describeWork } = this.#cfg;
    const known = this.#last;
    const snapshot = known ? known.snapshot : this.#measure();
    const age = known ? ` (снимок ${wholeSeconds(now() - known.at)} с назад)` : "";
    const heap = describeMainHeap(memoryUsage);
    const facts = [`процессор ${snapshot.cpu} %`, describeMemory(snapshot.memory) + (heap ? ` (${heap})` : "")];
    this.#record("resources", () => {
      return `${reason}${age}: ${facts.join(", ")}; шло: ${describeWork() || NOTHING_RUNNING}`;
    });
  };
}

export function createResourceMonitor({
  app,
  timers = { setInterval, clearInterval },
  now = () => Date.now(),
  log = appLog,
  describeWork = () => "",
  memoryUsage = () => process.memoryUsage(),
  cores = os.cpus()?.length || 1,
  cpuSpike = 50,
  memorySpikeMb = 300,
  intervalMs = 10_000,
  summaryMs = 600_000,
} = {}) {
  const settings = { app, timers, now, log, describeWork, memoryUsage, cores };
  const monitor = new ResourceMonitor({ ...settings, cpuSpike, memorySpikeMb, intervalMs, summaryMs });
  return { start: monitor.start, stop: monitor.stop, note: monitor.note, tick: monitor.tick };
}
