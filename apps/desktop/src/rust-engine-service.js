import { spawn } from "node:child_process";

export const ENGINE_IDLE_MS = 300000;

export const RUST_SERVE_COMMANDS = new Set([
  "read-archive-file",
  "list-archive-entries",
  "index-archive",
  "extract-archive-entries",
  "validate-rpf-patch",
  "convert-model",
  "convert-models",
  "read-model-ars2",
  "convert-scene",
  "build-world-place-scene",
  "create-image-card",
  "extract-textures",
  "extract-sky-textures",
  "extract-cloud-hats",
  "extract-map-tiles",
  "scan-preview-textures",
  "sample-anim-pose",
  "sample-anim-track",
]);

/*
 * Команды установки в резидентном движке (этап 1 «установка на Rust»). Список
 * отдельный от `RUST_SERVE_COMMANDS`: те команды читают и идут резиденту
 * всегда, а эти — только по выключателю `ASTRAL_ENGINE_INSTALL_SERVE=1` и только
 * если движок сказал, что умеет строки управления (потолки на ходу, отмена):
 * без них у установки не было бы ни смены потолка, ни отмены без убийства.
 */
export const RUST_SERVE_INSTALL_COMMANDS = new Set(["compose-rpf", "install-rpf-patch", "probe-rpf"]);

/* Переменные окружения, которые установка читает у процесса. Резидент получил своё окружение при запуске; если с тех пор оно разошлось, установка идёт процессом на команду. */
export const INSTALL_ENV_KEYS = [
  "LOCALAPPDATA",
  "XDG_DATA_HOME",
  "ASTRAL_ENGINE_RESTORE_ROOT",
  "MODOVIK_ARCHIVE_FIX_PATH",
  "MODOVIK_GTA_KEYS_PATH",
  "ASTRAL_ENGINE_BACKGROUND_IO",
  /* Отпечаток по ходу записи выключается на ходу после отказа проверки (`stream-sha.js`): резидент, запущенный с ним, установку больше не берёт. */
  "ASTRAL_ENGINE_STREAM_SHA",
  "ASTRAL_ENGINE_FAILPOINT",
  "ASTRAL_ENGINE_FAILPOINT_SLEEP",
];

const SWITCHED_OFF = new Set(["off", "0", "false", "no"]);
const SWITCHED_ON = new Set(["1", "on", "true", "yes"]);
const REPLY_BUFFER_LIMIT = 67108864;
const STDERR_KEPT_LINES = 20;
const STDERR_LINE_WIDTH = 500;
const STDERR_SHOWN_LINES = 3;
/* Строки журнала движка (`[Injector] …`, `[ArchiveFix] …`) идут в тот же stdout, что и ответы: хвост их помнит для отчёта об отказе установки. */
const LOG_KEPT_LINES = 60;
/* Ответ на строку управления приходит сразу; дольше этого движок считается не умеющим её. */
const CONTROL_TIMEOUT_MS = 5000;
/* Сколько отменяемая команда может останавливаться, прежде чем резидент снимают. */
export const CANCEL_GRACE_MS = 8000;

export function rustServeEnabled(env = process.env) {
  const word = String(env?.ASTRAL_RUST_SERVE ?? "").trim().toLowerCase();
  return !SWITCHED_OFF.has(word);
}

/** Выключатель установки в резиденте: по умолчанию выключен, включается `ASTRAL_ENGINE_INSTALL_SERVE=1`. */
export function rustInstallServeEnabled(env = process.env) {
  const word = String(env?.ASTRAL_ENGINE_INSTALL_SERVE ?? "").trim().toLowerCase();
  return SWITCHED_ON.has(word);
}

/* Значение переменной окружения без учёта регистра имени (на Windows так и есть). */
function envValue(environment, name) {
  if (!environment) return "";
  if (Object.hasOwn(environment, name)) return String(environment[name] ?? "");
  const wanted = name.toLowerCase();
  const found = Object.keys(environment).find((key) => key.toLowerCase() === wanted);
  return found === undefined ? "" : String(environment[found] ?? "");
}

function engineFailure(code, message, reason) {
  const failure = new Error(message);
  failure.code = code;
  if (reason !== undefined) failure.reason = reason;
  return failure;
}

function readPort(raw) {
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

// Резидентный процесс и всё, что с ним связано: очередь, смерти, таймеры.
class Supervisor {
  constructor({ spawnImpl, env, maxRestarts, windowMs, probeMs, idleMs, controlMs, now }) {
    this.limits = { maxRestarts, windowMs, probeMs, idleMs, controlMs };
    this.currentEnv = env;
    /* Окружение, с каким поднят нынешний процесс (снимок: сам объект могут менять). */
    this.launchedEnv = {};
    this.launched = false;
    this.launchProcess = (path) => {
      const environment = env();
      this.launchedEnv = { ...environment };
      this.launched = true;
      return spawnImpl(path, ["serve"], {
        windowsHide: true,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      });
    };
    this.readClock = () => now();
    this.live = null;
    this.waiting = new Map();
    this.serial = 0;
    this.port = null;
    this.carry = "";
    this.stderrTail = [];
    this.logTail = [];
    this.deathTimes = [];
    this.probeFailed = false;
    this.idleHandle = null;
  }

  isLive(child) {
    return this.live !== null && this.live.child === child;
  }

  available() {
    if (this.probeFailed) return false;
    const recent = this.deathTimes.filter((moment) => this.readClock() - moment < this.limits.windowMs);
    return recent.length < this.limits.maxRestarts;
  }

  // Процесс больше не текущий: порт и привязка сброшены.
  release() {
    const gone = this.live;
    this.live = null;
    this.port = null;
    return gone;
  }

  // Единственный путь завершения записи очереди.
  settle(id, error, value) {
    const ticket = this.waiting.get(id);
    if (!ticket) return;
    this.waiting.delete(id);
    clearTimeout(ticket.timer);
    if (error) ticket.reject(error);
    else ticket.resolve(value);
    for (const watcher of ticket.watchers ?? []) watcher();
    if (this.waiting.size === 0) this.armIdle();
  }

  failEveryone(makeFailure) {
    for (const id of [...this.waiting.keys()]) this.settle(id, makeFailure());
  }

  stderrNote() {
    if (this.stderrTail.length === 0) return "";
    return ` (${this.stderrTail.slice(-STDERR_SHOWN_LINES).join(" ")})`;
  }

  // --- запуск -------------------------------------------------------------

  start(path) {
    const started = this.launchProcess(path);
    this.live = { child: started, path, planned: false };
    this.carry = "";
    this.port = null;
    started.stdout.setEncoding?.("utf8");
    started.stdout.on("data", (chunk) => this.onStdout(started, chunk));
    started.stderr?.setEncoding?.("utf8");
    started.stderr?.on("data", (chunk) => this.onStderr(chunk));
    started.on("exit", (code) => this.onGone(started, code));
    started.on("error", () => this.onGone(started, undefined));
    started.stdin.on?.("error", () => {});
    this.sendProbe(started);
  }

  sendProbe(child) {
    const id = ++this.serial;
    const ticket = { id, child, reject() {}, resolve() {}, onProgress: null };
    ticket.timer = setTimeout(() => {
      if (!this.waiting.has(id)) return;
      this.probeFailed = true;
      this.retire(child, "no answer to the startup probe");
    }, this.limits.probeMs);
    this.waiting.set(id, ticket);
    try {
      child.stdin.write(`${JSON.stringify({ id, argv: ["engine-info"] })}\n`);
    } catch {
      // проба останется в работе до своего срока
    }
  }

  replaceWith(path) {
    if (this.live) this.live.child.kill();
    this.start(path);
  }

  // --- запросы ------------------------------------------------------------

  submit(path, argv, onProgress, timeoutMs) {
    return this.begin(path, argv, onProgress, timeoutMs).promise;
  }

  // Запрос с номером: `id` нужен строкам управления (потолки, отмена).
  begin(path, argv, onProgress, timeoutMs) {
    if (!this.available()) {
      return {
        id: null,
        promise: Promise.reject(engineFailure(
          "ENGINE_UNAVAILABLE",
          "Astral engine resident mode is off after repeated crashes.",
        )),
      };
    }
    if (!this.live || this.live.path !== path) this.replaceWith(path);
    clearTimeout(this.idleHandle);
    this.idleHandle = null;
    const id = ++this.serial;
    const owner = this.live.child;
    const promise = new Promise((resolve, reject) => {
      const ticket = { id, child: owner, onProgress, resolve, reject };
      ticket.timer = setTimeout(() => this.onDeadline(ticket), timeoutMs);
      this.waiting.set(id, ticket);
      try {
        owner.stdin.write(`${JSON.stringify({ id, argv })}\n`);
      } catch (error) {
        this.settle(id, error);
      }
    });
    return { id, promise };
  }

  // --- управление идущими запросами ----------------------------------------

  /*
   * Строка управления без `argv`: ответ приходит тем же видом `{id, exitCode,
   * response}`. Идёт текущему процессу: запрос, на который она нацелена, идёт
   * там же. Срок ответа не снимает процесс: молчание на управление — не
   * зависший запрос.
   */
  control(message, { timeoutMs = this.limits.controlMs } = {}) {
    if (!this.live) {
      return Promise.reject(engineFailure("ENGINE_STOPPED", "Astral engine is not running."));
    }
    const id = ++this.serial;
    const owner = this.live.child;
    return new Promise((resolve, reject) => {
      const ticket = { id, child: owner, onProgress: null, resolve, reject };
      ticket.timer = setTimeout(() => {
        this.settle(id, engineFailure("ENGINE_CONTROL_TIMEOUT", "Astral engine did not answer a control line."));
      }, timeoutMs);
      this.waiting.set(id, ticket);
      try {
        owner.stdin.write(`${JSON.stringify({ id, ...message })}\n`);
      } catch (error) {
        this.settle(id, error);
      }
    });
  }

  /*
   * Умеет ли нынешний процесс строки управления. Спрашивается один раз на
   * процесс: прежний движок отвечает на `hello` отказом «нужен argv» (или
   * молчит), новый — своим списком. `null` — не умеет; тогда установка идёт
   * процессом на команду, как раньше.
   */
  hello(path) {
    if (!this.available()) return Promise.resolve(null);
    if (!this.live || this.live.path !== path) this.replaceWith(path);
    if (this.live.hello === undefined) {
      this.live.hello = this.control({ control: "hello" })
        .then((reply) => {
          const result = reply?.response?.result;
          const known = reply?.response?.ok === true && Number(result?.protocol) >= 1 && Array.isArray(result?.controls);
          return known ? result : null;
        })
        .catch(() => null);
    }
    return this.live.hello;
  }

  /* Какие из этих переменных окружения с запуска процесса изменились. */
  envDiffers(names) {
    /* Процесс ещё не поднимался: снимка окружения нет, и сравнение с пустым звало любую непустую переменную расхождением. */
    if (!this.launched) return [];
    const now = this.currentEnv();
    return names.filter((name) => envValue(now, name) !== envValue(this.launchedEnv, name));
  }

  /*
   * Отмена без убийства: движок останавливает запрос в безопасной точке и
   * отвечает отказом `Cancelled`. Не ответил за `graceMs` — процесс снимается
   * (запасной путь, как раньше).
   */
  cancel(id, graceMs) {
    const ticket = this.waiting.get(id);
    if (!ticket) return Promise.resolve({ stopped: true, killed: false });
    return new Promise((resolve) => {
      let finished = false;
      let killed = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ stopped: true, killed });
      };
      const timer = setTimeout(() => {
        if (this.waiting.has(id)) {
          killed = true;
          this.retire(ticket.child, "cancel did not stop the request in time");
        }
        finish();
      }, graceMs);
      timer.unref?.();
      (ticket.watchers ??= []).push(finish);
      this.control({ control: "cancel", target: id }).catch(() => {});
    });
  }

  onDeadline(ticket) {
    this.settle(ticket.id, engineFailure("ENGINE_TIMEOUT", "Astral engine did not answer in time."));
    this.retire(ticket.child, "a request ran past its time limit");
  }

  // --- вывод процесса -----------------------------------------------------

  onStdout(child, chunk) {
    if (!this.isLive(child)) return;
    this.carry += chunk;
    if (this.carry.length > REPLY_BUFFER_LIMIT) {
      this.carry = "";
      this.retire(child, "reply line too long");
      return;
    }
    const lines = this.carry.split("\n");
    this.carry = lines.pop();
    for (const line of lines) this.onLine(line);
  }

  onStderr(chunk) {
    const fresh = String(chunk)
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => line.slice(0, STDERR_LINE_WIDTH));
    this.stderrTail = [...this.stderrTail, ...fresh].slice(-STDERR_KEPT_LINES);
  }

  onLine(line) {
    if (line.trim() === "") return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.logTail = [...this.logTail, line.slice(0, STDERR_LINE_WIDTH)].slice(-LOG_KEPT_LINES);
      return;
    }
    if (!message || typeof message !== "object") return;
    if (message.http && message.id === undefined) {
      this.port = readPort(message.http.port);
      return;
    }
    const ticket = this.waiting.get(message.id);
    if (!ticket) return;
    if (message.progress && !message.response) {
      try {
        ticket.onProgress?.(message.progress);
      } catch {
        // слушатель хода не должен мешать запросу
      }
      return;
    }
    this.settle(ticket.id, undefined, { exitCode: message.exitCode, response: message.response });
  }

  // --- уход процесса ------------------------------------------------------

  onGone(child, code) {
    if (!this.isLive(child)) return;
    const { planned } = this.release();
    if (!planned) this.deathTimes.push(this.readClock());
    this.failEveryone(() => engineFailure(
      "ENGINE_STOPPED",
      `Astral engine stopped (exit ${code ?? "?"})${this.stderrNote()}`,
      "exit",
    ));
  }

  retire(child, why) {
    if (!this.isLive(child)) return;
    this.release();
    this.deathTimes.push(this.readClock());
    this.failEveryone(() => engineFailure("ENGINE_STOPPED", `Astral engine stopped (${why})`, "retired"));
    child.kill();
  }

  // --- простой ------------------------------------------------------------

  armIdle() {
    clearTimeout(this.idleHandle);
    this.idleHandle = null;
    if (this.live === null || !(this.limits.idleMs > 0)) return;
    this.idleHandle = setTimeout(() => this.onIdle(), this.limits.idleMs);
    this.idleHandle.unref?.();
  }

  onIdle() {
    this.idleHandle = null;
    if (!this.live || this.waiting.size > 0) return;
    const gone = this.release();
    gone.planned = true;
    try {
      gone.child.stdin.end();
    } catch {
      // процесс уже отвязан
    }
  }

  warm(path) {
    if (!this.available()) return false;
    if (this.live === null || this.live.path !== path) this.replaceWith(path);
    else if (this.waiting.size === 0) this.armIdle();
    return true;
  }

  touch() {
    if (this.live !== null && this.waiting.size === 0) this.armIdle();
  }

  halt(planned) {
    clearTimeout(this.idleHandle);
    this.idleHandle = null;
    if (planned && this.live) this.live.planned = true;
    try {
      this.live?.child.stdin.end();
    } catch {
      // закрытие необязательно
    }
  }
}

export function createRustEngineService({
  spawnImpl = spawn,
  env = () => process.env,
  maxRestarts = 3,
  windowMs = 60000,
  probeMs = 15000,
  idleMs = ENGINE_IDLE_MS,
  controlMs = CONTROL_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const core = new Supervisor({ spawnImpl, env, maxRestarts, windowMs, probeMs, idleMs, controlMs, now });
  return {
    request(path, argv, { onProgress = null, timeoutMs = 600000 } = {}) {
      return core.submit(path, argv, onProgress, timeoutMs);
    },
    /** Тот же запрос, но с номером: `{ id, promise }`. Номер нужен строкам управления. */
    begin(path, argv, { onProgress = null, timeoutMs = 600000 } = {}) {
      return core.begin(path, argv, onProgress, timeoutMs);
    },
    /** Строка управления идущему запросу: `{ control: "limits", target, writeLimitMbps, readLimitMbps }` или `{ control: "cancel", target }`. */
    control(message, options) {
      return core.control(message, options);
    },
    /** Что умеет нынешний процесс: `{ protocol, controls, installCommands }` или `null` (прежний движок). */
    hello(path) {
      return core.hello(path);
    },
    /** Отмена запроса сообщением; не остановился за `graceMs` — процесс снимается. */
    cancel(id, { graceMs = CANCEL_GRACE_MS } = {}) {
      return core.cancel(id, graceMs);
    },
    /** Какие из переменных окружения разошлись с тем, с которым поднят процесс. */
    envDiffers(names = INSTALL_ENV_KEYS) {
      return core.envDiffers(names);
    },
    /** Последние строки журнала и stderr движка: для отчёта об отказе установки. */
    logTail() {
      return { stdout: core.logTail.join(String.fromCharCode(10)), stderr: [...core.stderrTail] };
    },
    available() {
      return core.available();
    },
    warm(path) {
      return core.warm(path);
    },
    touch() {
      core.touch();
    },
    stop({ planned = false } = {}) {
      core.halt(planned);
    },
    get pendingCount() {
      return core.waiting.size;
    },
    get httpPort() {
      return core.port;
    },
    get running() {
      return core.live !== null;
    },
    get pending() {
      return core.waiting.size;
    },
  };
}
