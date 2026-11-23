import fs from "node:fs";
import path from "node:path";
import { noteAppLeaving } from "./app-log.js";
import { onHibernate } from "./hibernation-hooks.js";

export const RUN_STATE_FILE = "run-state.json";
export const RUN_BEAT_FILE = "run-state.beat.json";

const DUMP_DEPTH = 2;
const DUMP_SLACK_MS = 1000;
const SECONDS_LIMIT = 90;
const UNKNOWN = "—";
const NO_VERSION = "версия неизвестна";
const OUTSIDE_NOTE = "Дампов падения нет: похоже, процесс закрыли снаружи (антивирус, система, диспетчер задач) "
  + "или он завис и его убили.";

const EXIT_NOTES = {
  beforeQuit: "Выход: приложение закрывается (before-quit)",
  lastWindow: "Выход: закрыто последнее окно",
  windowClosed: "Окно закрыто",
};

// ---------------------------------------------------------------- текст для журнала

const LIFESPAN_UNITS = [
  { below: SECONDS_LIMIT, show: (seconds) => `${seconds} с` },
  { below: Infinity, show: (seconds) => `${Math.round(seconds / 60)} мин` },
];

function lifespanLabel(seenAt, startedAt) {
  const span = Number(seenAt) - Number(startedAt);
  if (!Number.isFinite(span)) return UNKNOWN;
  const seconds = Math.max(0, Math.round(span / 1000));
  return LIFESPAN_UNITS.find((unit) => seconds < unit.below).show(seconds);
}

function beginLabel(run) {
  const known = Number.isFinite(Number(run.startedAt));
  return known ? new Date(Number(run.startedAt)).toISOString() : UNKNOWN;
}

// Что читается у прошлого запуска и в каком порядке: срок, начало, версия.
const REPORT_STEPS = [
  ["lived", (run) => lifespanLabel(run.seenAt, run.startedAt)],
  ["began", beginLabel],
  ["version", (run) => run.version || NO_VERSION],
];

function dumpsNote(dumps) {
  if (!(dumps.count > 0)) return OUTSIDE_NOTE;
  return `Найдено дампов падения: ${dumps.count}, последний ${new Date(dumps.last).toISOString()} — процесс упал сам.`;
}

export function describeUncleanExit(previous, dumps) {
  const said = {};
  for (const [key, read] of REPORT_STEPS) said[key] = read(previous);
  const head = [
    `Прошлый запуск (${said.version}, с ${said.began})`,
    "оборвался без штатного закрытия:",
    `проработал ${said.lived}.`,
  ].join(" ");
  return `${head} ${dumpsNote(dumps)}`;
}

// ---------------------------------------------------------------- чтение файлов состояния

// Два соседних файла: главный и пульс (путь пульса — рядом с главным).
class StateFiles {
  constructor(stateFile) {
    this.state = stateFile;
    this.beat = path.join(path.dirname(stateFile), RUN_BEAT_FILE);
  }
}

function readJsonObject(file, fsImpl) {
  let parsed = null;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(file, "utf8"));
  } catch {
    // нет файла, нет прав, испорченный текст — всё равно что «ничего нет»
  }
  return parsed instanceof Object ? parsed : null;
}

// Пульс засчитывается только своему запуску; seenAt берётся позднейший из двух файлов.
function mergePulse(state, beat) {
  const [pulseRun, stateRun] = [beat?.startedAt, state.startedAt].map(Number);
  if (pulseRun !== stateRun) return state;
  const seenAt = Math.max(...[state, beat].map((file) => Number(file.seenAt) || 0));
  return { ...state, seenAt };
}

function loadPrevious(files, fsImpl) {
  const state = readJsonObject(files.state, fsImpl);
  return state ? mergePulse(state, readJsonObject(files.beat, fsImpl)) : state;
}

export function readRunState(userData, fsImpl = fs) {
  return loadPrevious(new StateFiles(path.join(userData, RUN_STATE_FILE)), fsImpl);
}

// ---------------------------------------------------------------- дампы падения

// Обход папки дампов «подпапка сразу»: файлы корня и двух уровней вниз.
class DumpSurvey {
  constructor(fsImpl, startedAt) {
    this.fsImpl = fsImpl;
    this.floor = Number(startedAt) - DUMP_SLACK_MS;
    this.count = 0;
    this.last = 0;
  }

  list(dir) {
    try {
      return this.fsImpl.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  modifiedAt(file) {
    try {
      return this.fsImpl.statSync(file).mtimeMs;
    } catch {
      return NaN;
    }
  }

  take(modified) {
    if (!(modified >= this.floor)) return;
    this.count += 1;
    this.last = Math.max(this.last, modified);
  }

  visit(dir, depth) {
    const entries = this.list(dir);
    [...entries].forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < DUMP_DEPTH) this.visit(full, depth + 1);
      } else if (entry.name.toLowerCase().endsWith(".dmp")) {
        this.take(this.modifiedAt(full));
      }
    });
    return this;
  }

  result() {
    return { count: this.count, last: this.last };
  }
}

const findCrashDumps = (fsImpl, root, startedAt) => new DumpSurvey(fsImpl, startedAt).visit(root, 0).result();

// ---------------------------------------------------------------- запуск

const startElectronCrashReporter = async () => {
  const electron = await import("electron").catch(() => null);
  try {
    electron?.crashReporter?.start?.({ uploadToServer: false, compress: true, productName: "Astral" });
  } catch {
    // сборщик дампов необязателен
  }
};

// Где лежат файлы; сбой на любом шаге оставляет то, что уже найдено.
function locateFiles(app) {
  const found = {};
  try {
    found.files = new StateFiles(path.join(app.getPath("userData"), RUN_STATE_FILE));
    found.dumps = app.getPath("crashDumps");
  } catch {
    // нет папки — слежения не будет
  }
  return found;
}

const wasUnclean = (run) => Boolean(run) && run.closed !== true && Number.isFinite(Number(run.startedAt));

// Состояние текущего запуска, таймер пульса и запись обоих файлов.
class RunTracker {
  constructor({ files, fsImpl, now, beatMs, state, isStopped }) {
    Object.assign(this, { files, fsImpl, readClock: now, beatMs, state, isStopped });
    this.timer = null;
    this.writing = false;
    this.tick = () => this.beat();
  }

  clock() {
    const { readClock } = this;
    return readClock();
  }

  saveState() {
    try {
      this.fsImpl.writeFileSync(this.files.state, JSON.stringify(this.state));
    } catch {
      // диск не принял — запуск этого не замечает
    }
  }

  // Пульс пишется атомарно: текст ложится во временный файл рядом, потом rename поверх файла пульса —
  // читатель видит прежний целый пульс или новый целый, но не пустой и не обрезанный. Нет rename у
  // fsImpl (заглушка без него) — запись прямо в файл пульса, как раньше.
  replaceBeat(writeFile, text) {
    const rename = this.fsImpl.promises.rename;
    if (typeof rename !== "function") return writeFile(this.files.beat, text);
    const temp = `${this.files.beat}.tmp`;
    return writeFile(temp, text)
      .then(() => rename(temp, this.files.beat))
      .catch(() => Promise.resolve(this.fsImpl.promises.rm?.(temp, { force: true })).catch(() => {}));
  }

  // Пульс пишется по одной записи; отказ записи гасится, признак «пишется» снимается в конце цепочки.
  pulse() {
    if (this.writing || this.isStopped()) return;
    const writeFile = this.fsImpl.promises?.writeFile;
    if (typeof writeFile !== "function") return;
    this.writing = true;
    const { startedAt, seenAt } = this.state;
    this.replaceBeat(writeFile, JSON.stringify({ startedAt, seenAt }))
      .catch(() => {})
      .finally(() => {
        this.writing = false;
      });
  }

  beat() {
    this.state.seenAt = this.clock();
    this.pulse();
  }

  arm() {
    this.timer = setInterval(this.tick, this.beatMs);
    this.timer.unref?.();
  }

  disarm() {
    clearInterval(this.timer);
    this.timer = null;
  }

  resume() {
    this.state.seenAt = this.clock();
    this.pulse();
    this.arm();
  }

  close() {
    clearInterval(this.timer);
    this.state.seenAt = this.clock();
    this.state.closed = true;
    this.saveState();
  }
}

export function startRunState({
  app,
  log,
  version = "",
  now = Date.now,
  fsImpl = fs,
  processRef = process,
  beatMs = 60000,
  startCrashDumps = startElectronCrashReporter,
  onLeaving = noteAppLeaving,
}) {
  const { files, dumps: dumpsDir } = locateFiles(app);
  if (!files) return { stop: () => {} };

  void startCrashDumps();

  const record = (level, message) => log.record({
    level,
    source: "app",
    message: typeof message === "function" ? message() : message,
  });

  const previous = loadPrevious(files, fsImpl);
  if (wasUnclean(previous)) {
    const dumps = dumpsDir ? findCrashDumps(fsImpl, dumpsDir, previous.startedAt) : { count: 0, last: 0 };
    record("warn", () => describeUncleanExit(previous, dumps));
  }

  const startedAt = now();
  /* Флаг объявлен до первого использования: запись пульса и wake читают его, даже если onHibernate бросит (тогда startRunState падает с её ошибкой, а не ReferenceError из тика). */
  let stopped = false;
  const tracker = new RunTracker({
    files,
    fsImpl,
    now,
    beatMs,
    isStopped: () => stopped,
    state: {
      pid: processRef.pid,
      startedAt,
      seenAt: startedAt,
      /* Номер выпуска беты (0.9.0-beta.N), как в шапке журнала; его даёт вызывающий (`desktop-auth.js`), а не package.json (1.0.1). */
      version: version || app.getVersion?.() || "",
      closed: false,
    },
  });
  tracker.saveState();
  tracker.arm();

  onHibernate("run-state", {
    sleep() {
      tracker.disarm();
    },
    wake() {
      if (stopped || tracker.timer) return;
      tracker.resume();
    },
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    tracker.close();
  }

  app.on?.("will-quit", stop);
  processRef.on?.("exit", stop);
  [
    ["before-quit", () => {
      onLeaving?.();
      record("info", EXIT_NOTES.beforeQuit);
    }],
    ["window-all-closed", () => record("info", EXIT_NOTES.lastWindow)],
    ["browser-window-created", (_event, window) => (
      window?.once?.("closed", () => record("info", EXIT_NOTES.windowClosed))
    )],
  ].forEach(([event, handler]) => app.on?.(event, handler));
  return { stop };
}
