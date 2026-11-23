// Отчёты об ошибках приложения: форма на проводе, очистка от личного, отпечаток, очередь.
// Сеть, диск и согласие приходят снаружи параметрами сборщика.

export const APP_ERROR_LIMITS = Object.freeze({
  message: 400,
  stack: 3000,
  perMinute: 5,
  queue: 50,
  batch: 2,
  repeatWindowMs: 600000,
  retryMinMs: 30000,
  retryMaxMs: 600000,
  debounceMs: 2000,
});

export const APP_ERROR_SOURCES = Object.freeze(["renderer", "main", "native-host"]);

export const APP_ERROR_PAGES = Object.freeze([
  "/app",
  "/app/catalog",
  "/app/workshop",
  "/app/installed",
  "/app/builds",
  "/app/settings",
]);

const MAX_REPEATS = 100000;
const NEW_ERRORS_WINDOW_MS = 60000;

const textOf = (value) => (value === null || value === undefined ? "" : String(value));

// --- Очистка текста.

const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._%+-]/;
const EMAIL_LABEL_CHAR = /[A-Za-z0-9-]/;

function labelEnd(text, from) {
  let end = from;
  while (end < text.length && EMAIL_LABEL_CHAR.test(text[end])) end += 1;
  return end;
}

// Конец домена: хотя бы две части через точку, иначе -1.
function domainEnd(text, from) {
  let end = labelEnd(text, from);
  if (end === from) return -1;
  let parts = 1;
  while (text[end] === ".") {
    const next = labelEnd(text, end + 1);
    if (next === end + 1) break;
    end = next;
    parts += 1;
  }
  return parts >= 2 ? end : -1;
}

// Разбор от каждого «@», а не регулярное выражение: длинный текст без почты не даёт квадратичного перебора.
function maskEmails(text) {
  let result = "";
  let copied = 0;
  for (let at = text.indexOf("@"); at >= 0; at = text.indexOf("@", at + 1)) {
    let start = at;
    while (start > copied && EMAIL_LOCAL_CHAR.test(text[start - 1])) start -= 1;
    const end = start < at ? domainEnd(text, at + 1) : -1;
    if (end >= 0) {
      result += `${text.slice(copied, start)}<email>`;
      copied = end;
      at = end - 1;
    }
  }
  return result + text.slice(copied);
}

const swap = (pattern, replacement) => (text) => text.replace(pattern, replacement);

// Порядок виден снаружи.
// Папка пользователя без косой после имени кончается там же, где у Windows: имя может быть с пробелом
// («/Users/Ivan Petrov»), и обрыв на пробеле отправлял фамилию на сервер.
// Секрет в кавычках скрывается так же, как без них: `token="…"` и `"password": "…"` (в JSON — кроме
// `key` и `code`, это обычные несекретные поля).
const SCRUB_STEPS = [
  swap(/(?:file:\/\/\/)?[a-z]:[\\/]+users[\\/]+[^\\/\n'"<>|:*?]+/gi, "~"),
  swap(/\/(?:Users|home)\/[^/\n'"<>|:*?]+\//g, "~/"),
  swap(/\/(?:Users|home)\/[^/\n'"<>|:*?]+/g, "~"),
  maskEmails,
  swap(/\b(?:bearer|dpop|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "<secret>"),
  swap(/\b(token|access_token|refresh_token|secret|password|passwd|key|authorization|code)=(["'])(?:(?!\2)[^\n])+\2/gi, "$1=$2<secret>$2"),
  swap(/("(?:token|access_token|refresh_token|secret|password|passwd|authorization)"\s*:\s*")(?:[^"\\\n]|\\.)+"/gi, '$1<secret>"'),
  swap(/\b(token|access_token|refresh_token|secret|password|passwd|key|authorization|code)=[^&\s'"]+/gi, "$1=<secret>"),
  /* Четыре числа после имени библиотеки (`majestic-client.dll 1.23.41.0`) или слов version/ver/v/build — версия, а не адрес: улика падения игры (11.11.2026). */
  swap(/(?<!(?:\.(?:dll|exe|asi|sys|ocx|drv)|\b(?:version|ver|v|build))[\s:=]*)\b\d{1,3}(?:\.\d{1,3}){3}\b/gi, "<ip>"),
];

export function scrubText(value, limit = 3000) {
  const text = SCRUB_STEPS.reduce((current, step) => step(current), textOf(value));
  // Единиц UTF-16 не больше предела: кодовых точек тем более.
  if (!(text.length > limit)) return text;
  const points = [...text];
  return points.length > limit ? points.slice(0, limit).join("") : text;
}

// --- Отпечаток.

const FNV_PRIME = 0x01000193;

function fnvHex(text, seed) {
  let hash = seed;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const MESSAGE_SHAPING = [
  swap(/https?:\/\/\S+/gi, "<url>"),
  swap(/[0-9a-f]{8,}/gi, "<hex>"),
  swap(/\d+/g, "#"),
  swap(/\s+/g, " "),
];

function messageShape(message) {
  const shaped = MESSAGE_SHAPING.reduce((current, step) => step(current), textOf(message));
  return shaped.trim().slice(0, 200);
}

const V8_FRAME = /^\s*at\s(?:(.+?)\s+\()?(.+?)(?::\d+)?(?::\d+)?\)?\s*$/;
const BARE_FRAME = /^(.*?)@(.+?)(?::\d+)?(?::\d+)?\s*$/;

function* framesOf(stack) {
  for (const line of textOf(stack).split(/\r?\n/)) {
    const match = V8_FRAME.exec(line) ?? BARE_FRAME.exec(line);
    if (match) {
      const name = (match[1] ?? "").trim() || "<anonymous>";
      const file = match[2].split(/[\\/]/).pop().split(/[?#]/, 1)[0];
      yield `${name}@${file}`;
    }
  }
}

function frameTrail(stack) {
  const trail = [];
  for (const frame of framesOf(stack)) {
    trail.push(frame);
    if (trail.length === 3) break;
  }
  return trail.join("|");
}

export function errorFingerprint({ kind, message, stack }) {
  const source = `${kind}\u0000${messageShape(message)}\u0000${frameTrail(stack)}`;
  return fnvHex(source, 0x811c9dc5) + fnvHex(source, FNV_PRIME);
}

// --- Сборка отчёта.

const KIND_LENGTH = 64;

function cleanKind(kind) {
  const text = String(kind || "Error").replace(/[^A-Za-z0-9_.: -]/g, "").trim();
  return /^[A-Za-z]/.test(text) && text.length <= KIND_LENGTH ? text : "Error";
}

function cleanVersion(version) {
  return String(version || "").replace(/[^A-Za-z0-9.+-]/g, "").slice(0, 32) || "0.0.0";
}

function cleanOs(os) {
  return String(os || "").replace(/[^A-Za-z0-9 ._()-]/g, "").trim().slice(0, 64) || "unknown";
}

export function buildReport({ kind, message, stack, source, page, appVersion, os }) {
  const cleanMessage = scrubText(message, APP_ERROR_LIMITS.message).trim();
  if (!cleanMessage) return null;
  const cleanStack = scrubText(stack, APP_ERROR_LIMITS.stack);
  const safeKind = cleanKind(kind);
  const report = {
    kind: safeKind,
    fingerprint: errorFingerprint({ kind: safeKind, message: cleanMessage, stack: cleanStack }),
    message: cleanMessage,
    app_version: cleanVersion(appVersion),
    os: cleanOs(os),
    source: APP_ERROR_SOURCES.includes(source) ? source : "renderer",
  };
  if (cleanStack) report.stack = cleanStack;
  if (APP_ERROR_PAGES.includes(page)) report.page = page;
  return report;
}

// --- Годность отчёта: таблица «ключ → правило»; другие ключи отчёту запрещены.

const asText = (value) => String(value || "");
const shortEnough = (text, limit) => text.length <= limit || [...text].length <= limit;

const WIRE_RULES = {
  kind: (value) => /^[A-Za-z][A-Za-z0-9_.: -]{0,63}$/.test(asText(value)),
  fingerprint: (value) => /^[0-9a-f]{8,32}$/.test(asText(value)),
  message: (value) => typeof value === "string" && value.trim() !== "" && shortEnough(value, 500),
  stack: (value) => value === undefined || (typeof value === "string" && shortEnough(value, 4000)),
  app_version: (value) => /^[A-Za-z0-9.+-]{1,32}$/.test(asText(value)),
  os: (value) => /^[A-Za-z0-9 ._()-]{1,64}$/.test(asText(value)),
  page: (value) => value === undefined || APP_ERROR_PAGES.includes(value),
  source: (value) => APP_ERROR_SOURCES.includes(value),
  repeats: (value) => value === undefined || (Number.isInteger(value) && value >= 0 && value <= MAX_REPEATS),
};

export function validWireReport(report) {
  if (typeof report !== "object" || report === null || Array.isArray(report)) return false;
  if (!Object.keys(report).every((key) => Object.hasOwn(WIRE_RULES, key))) return false;
  return Object.entries(WIRE_RULES).every(([key, allowed]) => allowed(report[key]));
}

export function wireEvent(report, crash = false) {
  return { type: crash ? "crash" : "error", error: report };
}

export function memoryQueue(initial = []) {
  let items = [...initial];
  return {
    load: () => [...items],
    save(next) {
      items = [...next];
    },
  };
}

// --- Сборщик: состояние одной трубы от приёма ошибки до отправки.

class ReportPipeline {
  #isEnabled;
  #send;
  #queue;
  #defaults;
  #now;
  #setTimer;
  #clearTimer;
  #limits;

  #timer = null;
  #flight = null;
  #failures = 0;
  #retryAt = 0;
  #seen = new Map();
  #acceptedAt = [];

  constructor({
    isEnabled,
    send,
    queue = memoryQueue(),
    defaults = {},
    now = () => Date.now(),
    setTimer = (run, ms) => setTimeout(run, ms),
    clearTimer = (timer) => clearTimeout(timer),
    limits = APP_ERROR_LIMITS,
  }) {
    this.#isEnabled = isEnabled;
    this.#send = send;
    this.#queue = queue;
    this.#defaults = defaults;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#limits = limits;
  }

  capture(error, { kind, source, page, crash = false } = {}) {
    if (!this.#consentHolds()) return false;
    const report = this.#reportFrom(error, { kind, source, page });
    if (!report) return false;
    const admission = this.#admit(report.fingerprint);
    if (!admission) return false;
    if (admission.repeats !== undefined) report.repeats = admission.repeats;
    this.#enqueue({ crash, report });
    // Падение не ждёт уже взведённой отложенной отправки: процесс может до неё не дожить.
    if (crash) this.dispose();
    this.#arm(crash ? 0 : this.#limits.debounceMs);
    return true;
  }

  flush() {
    if (!this.#flight) {
      this.#flight = this.#runPass().finally(() => {
        this.#flight = null;
      });
    }
    return this.#flight;
  }

  pending() {
    return this.#queue.load().length;
  }

  dispose() {
    if (this.#timer === null) return;
    this.#clearTimer(this.#timer);
    this.#timer = null;
  }

  #consentHolds() {
    if (this.#isEnabled()) return true;
    if (this.#queue.load().length > 0) this.#queue.save([]);
    this.dispose();
    return false;
  }

  #reportFrom(error, { kind, source, page }) {
    const isObject = Boolean(error) && typeof error === "object";
    const defaults = this.#defaults;
    return buildReport({
      kind: kind || (isObject && error.name) || "Error",
      message: isObject ? error.message ?? String(error) : String(error),
      stack: isObject ? error.stack : undefined,
      source: source || defaults.source,
      page: page ?? defaults.getPage?.(),
      appVersion: defaults.appVersion,
      os: defaults.os,
    });
  }

  // null: запись не нужна; иначе решение с необязательным числом повторов.
  #admit(fingerprint) {
    const now = this.#now();
    const known = this.#seen.get(fingerprint);
    if (known) {
      known.count += 1;
      if (now - known.writtenAt < this.#limits.repeatWindowMs) return null;
      const repeats = Math.min(known.count, MAX_REPEATS);
      known.count = 0;
      known.writtenAt = now;
      return { repeats };
    }
    this.#acceptedAt = this.#acceptedAt.filter((at) => now - at < NEW_ERRORS_WINDOW_MS);
    if (this.#acceptedAt.length >= this.#limits.perMinute) return null;
    this.#acceptedAt.push(now);
    this.#seen.set(fingerprint, { count: 0, writtenAt: now });
    return {};
  }

  #enqueue(entry) {
    this.#queue.save([...this.#queue.load(), entry].slice(-this.#limits.queue));
  }

  // null значит «не взведён»; любое другое значение setTimer, и undefined тоже, считается взведённым.
  #arm(ms) {
    if (this.#timer !== null) return;
    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      this.flush();
    }, ms);
    this.#timer?.unref?.();
  }

  async #runPass() {
    if (!this.#consentHolds()) return;
    const remaining = this.#retryAt - this.#now();
    if (remaining > 0) {
      this.#arm(Math.max(this.#limits.debounceMs, remaining));
      return;
    }
    while (this.#queue.load().length > 0) {
      const delivered = await this.#deliverNextBatch();
      if (!delivered || !this.#consentHolds()) return;
    }
  }

  /*
   * Убрала ли очередь отправленное (05.11.2026): файл очереди может не поддаваться ни перезаписи, ни удалению
   * (держит антивирус, нет места), `save` это глотает — и цикл прохода слал одни и те же записи без конца.
   * Голова очереди та же — проход кончается; записи уйдут ещё раз со следующим проходом, а не в цикле.
   */
  #headMoved(batch) {
    const head = this.#queue.load()[0];
    return !head || JSON.stringify(head) !== JSON.stringify(batch[0]);
  }

  async #deliverNextBatch() {
    const batch = this.#queue.load().slice(0, this.#limits.batch);
    const events = batch
      .filter((entry) => validWireReport(entry.report))
      .map((entry) => wireEvent(entry.report, entry.crash));
    if (events.length > 0) {
      try {
        await this.#send(events);
      } catch {
        this.#scheduleRetry();
        return false;
      }
    }
    this.#failures = 0;
    this.#queue.save(this.#queue.load().slice(batch.length));
    return this.#headMoved(batch);
  }

  #scheduleRetry() {
    const { retryMinMs, retryMaxMs } = this.#limits;
    this.#failures += 1;
    const wait = Math.min(retryMaxMs, retryMinMs * 2 ** (this.#failures - 1));
    this.#retryAt = this.#now() + wait;
    this.#arm(wait);
  }
}

export function createErrorReporter(settings) {
  const pipeline = new ReportPipeline(settings);
  return {
    capture: (error, options) => pipeline.capture(error, options),
    flush: () => pipeline.flush(),
    pending: () => pipeline.pending(),
    dispose: () => pipeline.dispose(),
  };
}
