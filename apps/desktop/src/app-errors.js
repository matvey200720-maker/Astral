import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { onHostFailure } from "./native-engine.js";
import * as contract from "@modovik/contracts/app-errors";

const HOUR_MS = 3600000;
/* Виды отчётов, к которым журнал не прикладывается (решение лида 22.11.2026: расхождение update.rpf — только строка с огрызками отпечатков). */
const NO_LOG_KINDS = new Set(["UpdateBaseDrift"]);
const QUEUE_FILE = "app-errors-queue.json";
const SETTINGS_FILE = "app-errors.json";
const INSTALL_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Одна строка стека: «что угодно в одну строку», пробел, непустой хвост без пробельных знаков.
// Знаки конца строки (кроме перевода строки и возврата каретки) собираются по кодам.
const LINE_BREAKS = String.fromCharCode(0x2028, 0x2029);
const STACK_LINE_SHAPE = new RegExp(String.raw`^([^\n\r${LINE_BREAKS}]*) (\S+)$`);
const PLATFORM_NAMES = new Map([
  ["win32", "Windows"],
  ["darwin", "macOS"],
  ["linux", "Linux"],
]);
const HOST_TAIL_LINES = 40;

export const ERROR_LOG_LIMITS = Object.freeze({
  perHour: 3,
  rawBytes: 8388608,
  gzipBytes: 1048576,
});

export const previewReport = contract.buildReport;

const noop = () => undefined;

// ---------------------------------------------------------------- диск

// Результат действия либо запасное значение, если оно отказало (любой сбой молча глотается).
function attemptOr(action, fallback) {
  try {
    return action();
  } catch {
    return fallback;
  }
}

// Запись через соседний временный файл: три шага по порядку, любой сбой молча глотается,
// отчёты тогда продолжают работать в памяти этого запуска.
function writeJson(fsImpl, file, value) {
  attemptOr(() => {
    const parents = { recursive: true };
    fsImpl.mkdirSync(path.dirname(file), parents);
    const scratch = [file, process.pid, "tmp"].join(".");
    const text = JSON.stringify(value);
    fsImpl.writeFileSync(scratch, text, "utf8");
    fsImpl.renameSync(scratch, file);
  }, undefined);
}

// Содержимое JSON-файла либо запасное значение, если файла нет или он не читается.
function readJsonOr(fsImpl, file, fallback) {
  return attemptOr(() => JSON.parse(fsImpl.readFileSync(file, "utf8")), fallback);
}

export function readErrorSettings(userData, fsImpl = fs) {
  const file = path.join(userData, SETTINGS_FILE);
  const stored = readJsonOr(fsImpl, file, undefined);
  const knownId = stored?.installId;
  const wellFormed = INSTALL_ID_SHAPE.test(knownId || "");
  const installId = wellFormed ? knownId : randomUUID();
  const enabled = typeof stored?.enabled === "boolean" ? stored.enabled : true;
  const changed = stored?.installId !== installId || stored?.enabled !== enabled;
  if (changed) writeJson(fsImpl, file, { enabled, installId });
  return { enabled, installId, file };
}

// Строка очереди годится, если это объект с флагом crash и допустимым отчётом; правила идут по порядку.
const QUEUE_ROW_RULES = [
  (row) => Boolean(row) && typeof row === "object",
  (row) => typeof row.crash === "boolean",
  (row) => contract.validWireReport(row.report),
];

const isQueueRow = (row) => QUEUE_ROW_RULES.every((rule) => rule(row));

export function createFileQueue(file, fsImpl = fs) {
  return {
    load() {
      const rows = readJsonOr(fsImpl, file, []);
      if (!Array.isArray(rows)) return [];
      const valid = rows.filter(isQueueRow);
      return valid.slice(-contract.APP_ERROR_LIMITS.queue);
    },
    save(list) {
      // очередь на диске — удобство, не обязанность
      attemptOr(() => (list.length ? writeJson(fsImpl, file, list) : fsImpl.rmSync(file, { force: true })), undefined);
    },
  };
}

// ---------------------------------------------------------------- журнал приложения

// Последние `keep` байт, начиная с целого знака: обломки в голове отбрасываются.
function wholeTail(bytes, keep) {
  const decoded = bytes.subarray(bytes.length - keep).toString("utf8");
  return Buffer.from(decoded.replace(/^�+/, ""), "utf8");
}

export function packErrorLog(text, options = {}) {
  const limits = options.limits === undefined ? ERROR_LOG_LIMITS : options.limits;
  const gzip = options.gzip === undefined ? gzipSync : options.gzip;
  let bytes = Buffer.from(text ? String(text) : "", "utf8");
  if (bytes.length === 0) return null;
  if (bytes.length > limits.rawBytes) {
    bytes = wholeTail(bytes, limits.rawBytes);
  }
  const packed = gzip(bytes);
  if (!(packed.byteLength <= limits.gzipBytes)) return null;
  return packed;
}

// Что уходит в облако вместе с журналом.
function parcelOf(report, body) {
  return Object.fromEntries([
    ["fingerprint", report.fingerprint],
    ["kind", report.kind],
    ["appVersion", report.app_version],
    ["body", body],
  ]);
}

const failedOutcome = () => ({ status: "failed" });

// Состояние отправки журнала: одна отправка за раз, окно часа, блокировка, «absent».
function createLogGate(cfg) {
  let stopped = false;
  let busy = false;
  let blockedUntil = 0;
  const spent = new Set();
  const stamps = [];

  // Один проход: первое «crash» среди ещё не отправленных, иначе первое не отправленное.
  function choose(events) {
    const list = Array.isArray(events) ? events : [];
    const fresh = list.filter((event) => {
      const fingerprint = event?.error?.fingerprint;
      return fingerprint && !spent.has(fingerprint) && !NO_LOG_KINDS.has(event?.error?.kind);
    });
    const crash = fresh.find((event) => event.type === "crash");
    return crash === undefined ? fresh[0] : crash;
  }

  async function deliver(report) {
    const { upload, buildLog, pack, now } = cfg;
    const log = await buildLog();
    const body = pack(log);
    if (!body) return { status: "empty" };
    const reply = await upload(parcelOf(report, body));
    switch (reply?.status) {
      case "absent":
        stopped = true;
        break;
      case "limited":
        blockedUntil = now() + (reply.retryAfterMs || HOUR_MS);
        break;
      default:
        break;
    }
    return reply;
  }

  // Слово «empty» не засчитывается: отпечаток возвращается в запас, отметка снимается.
  const refund = (fingerprint, at) => {
    spent.delete(fingerprint);
    stamps.splice(stamps.indexOf(at), 1);
  };

  function settle(outcome, fingerprint, at) {
    if (outcome?.status === "empty") refund(fingerprint, at);
    return outcome;
  }

  // Время начала, если отправлять сейчас можно: не остановлено, не занято, включено, не заблокировано.
  function openAt() {
    const { upload, isEnabled, now } = cfg;
    if (stopped || busy || typeof upload !== "function") return null;
    if (!isEnabled()) return null;
    const at = now();
    return at < blockedUntil ? null : at;
  }

  // старые отметки снимаются только с головы списка и до первой не устаревшей
  function dropExpired(at) {
    const firstLive = stamps.findIndex((stamp) => !(at - stamp >= HOUR_MS));
    stamps.splice(0, firstLive === -1 ? stamps.length : firstLive);
  }

  const release = () => {
    busy = false;
  };

  function startDelivery(report, at) {
    const { fingerprint } = report;
    spent.add(fingerprint);
    stamps.push(at);
    busy = true;
    return deliver(report)
      .catch(failedOutcome)
      .then((outcome) => settle(outcome, fingerprint, at))
      .finally(release);
  }

  function afterReports(events) {
    const at = openAt();
    if (at === null) return null;
    dropExpired(at);
    if (stamps.length >= cfg.limits.perHour) return null;
    const event = choose(events);
    if (!event) return null;
    return startDelivery(event.error, at);
  }

  return { afterReports };
}

export function createErrorLogUploader(options) {
  const { upload, buildLog } = options;
  const limits = options.limits === undefined ? ERROR_LOG_LIMITS : options.limits;
  const pack = options.pack === undefined ? (log) => packErrorLog(log, { limits }) : options.pack;
  const now = options.now === undefined ? Date.now : options.now;
  const isEnabled = options.isEnabled === undefined ? () => true : options.isEnabled;
  const gate = createLogGate({ upload, buildLog, isEnabled, now, limits, pack });
  return {
    afterReports(events) {
      return gate.afterReports(events);
    },
  };
}

// ---------------------------------------------------------------- описания сбоев

function clip(value, size) {
  return String(value).slice(0, size);
}

function textUpTo(value, size) {
  if (typeof value !== "string") return "";
  return value.slice(0, size);
}

// Причина и код выхода: только латиница, цифры, «_», «.», «-», не больше 32 знаков.
function safeToken(value) {
  if (value == null) return "";
  const cleaned = String(value).replace(/[^\w.-]/g, "");
  return cleaned.slice(0, 32);
}

function stallSeconds(ms) {
  const wait = Number(ms);
  const seconds = (wait > 0 ? wait : 0) / 1000;
  return `${seconds.toFixed(1)} s`;
}

function busyChannels(channels) {
  const names = [].concat(channels).join(", ").slice(0, 300);
  return names || "background tasks";
}

// «имя место» -> «    at имя (место)»; строки, не подходящие под форму, пропускаются.
function stackFrames(text) {
  const source = text == null ? "" : String(text);
  const frames = [];
  for (const line of source.slice(0, 3000).split("\n")) {
    const match = STACK_LINE_SHAPE.exec(line.trim());
    if (match) frames.push(`    at ${match[1]} (${match[2]})`);
  }
  return frames.join("\n");
}

function describeMainStall({ ms, channels, top, text }) {
  const lead = `Main process stalled ${stallSeconds(ms)}; busy: ${busyChannels(channels)}`;
  const message = lead + (top ? `; стек: ${clip(top, 200)}` : "");
  const stack = stackFrames(text);
  return { message, stack };
}

function describeStackStall({ ms, top, text }) {
  const where = clip(top ?? "", 200) || "unknown";
  return { message: `Main thread stalled ${stallSeconds(ms)} in ${where}`, stack: stackFrames(text) };
}

function describeWindowHang({ ms }) {
  return { message: `Window did not respond for ${stallSeconds(ms)}` };
}

const HANG_KINDS = new Map([
  ["main", { kind: "MainStall", describe: describeMainStall }],
  ["stack", { kind: "MainStallStack", describe: describeStackStall }],
  ["window", { kind: "WindowHang", describe: describeWindowHang }],
]);

// Поля отчёта страницы: [куда в ошибке, откуда во входе, предел знаков].
const RENDERER_ERROR_FIELDS = [
  ["name", "kind", 64],
  ["message", "message", 2000],
  ["stack", "stack", 8000],
];

function isObjectInput(value) {
  if (value === null || Array.isArray(value)) return false;
  return typeof value === "object";
}

function crashListener(capture) {
  return (error, origin) => {
    const kind = origin === "unhandledRejection" ? "unhandledRejection" : "uncaughtException";
    capture(error, { crash: true, source: "main", kind });
  };
}

function rejectionListener(capture) {
  return (reason) => {
    const meta = { source: "main", kind: "unhandledRejection" };
    capture(reason, meta);
    console.error("Unhandled promise rejection in the main process:", reason);
  };
}

// Последние строки хвоста вывода хоста одним текстом.
function tailText(tail) {
  if (!Array.isArray(tail)) return "";
  return tail.slice(-HOST_TAIL_LINES).join("\n");
}

// ---------------------------------------------------------------- сборщик главного процесса

function platformLabel(platform) {
  return PLATFORM_NAMES.get(platform) ?? platform;
}

function mainDefaults(appVersion, platform, release) {
  return { appVersion, os: `${platformLabel(platform)} ${release}`, source: "main" };
}

// Ответ облака с каналом «account» запускает отправку журнала, не дожидаясь её.
function afterDelivery(logs, events, reply) {
  const startsLog = reply?.channel === "account";
  if (startsLog) logs.afterReports(events);
  return reply;
}

// Зависимости, которые можно подменить в settings; значение по умолчанию считается лишь при undefined.
const SETTING_DEFAULTS = [
  ["fsImpl", () => fs],
  ["buildLog", () => () => ""],
  ["platform", () => process.platform],
  ["release", () => os.release()],
];

export function createMainErrorReporting(settings) {
  const { userData, uploadLog, send, appVersion, now, setTimer, clearTimer } = settings;
  const resolved = Object.fromEntries(
    SETTING_DEFAULTS.map(([key, make]) => [key, settings[key] === undefined ? make() : settings[key]]),
  );
  const { fsImpl, buildLog, platform, release } = resolved;

  const stored = readErrorSettings(userData, fsImpl);
  const queue = createFileQueue(path.join(userData, QUEUE_FILE), fsImpl);
  const { installId, file: settingsFile } = stored;
  let enabled = stored.enabled;
  const clock = now ? { now } : {};
  const timers = setTimer ? { setTimer, clearTimer } : {};

  const logs = createErrorLogUploader({ upload: uploadLog, isEnabled: () => enabled, buildLog, ...clock });

  async function sendReports(events) {
    const reply = await send(events, installId);
    return afterDelivery(logs, events, reply);
  }

  const reporter = contract.createErrorReporter({
    isEnabled: () => enabled,
    send: sendReports,
    queue,
    defaults: mainDefaults(appVersion, platform, release),
    ...clock,
    ...timers,
  });

  return {
    install(target = process) {
      target.on("uncaughtExceptionMonitor", crashListener(reporter.capture));
      target.on("unhandledRejection", rejectionListener(reporter.capture));
    },
    capture: reporter.capture,
    flush() {
      return reporter.flush().then(noop, noop);
    },
    pending: reporter.pending,
    setEnabled(value) {
      enabled = value === true;
      writeJson(fsImpl, settingsFile, { enabled, installId });
      if (!enabled) queue.save([]);
      return { enabled };
    },
    getState: () => ({ enabled }),
    reportFromRenderer(input) {
      if (!isObjectInput(input)) return { accepted: false };
      const error = {};
      for (const [to, from, cap] of RENDERER_ERROR_FIELDS) error[to] = textUpTo(input[from], cap);
      return { accepted: reporter.capture(error, { source: "renderer", page: textUpTo(input.page, 64) }) };
    },
    hostFailure(failure) {
      const { command, message, tail } = failure;
      const info = {
        message: `${command || "native-host"}: ${message || "failure"}`,
        stack: tailText(tail),
      };
      const meta = { kind: "NativeHostFailure", source: "native-host" };
      return reporter.capture(info, meta);
    },
    processGone(details) {
      const { type, reason, exitCode } = details;
      const gpu = type === "GPU";
      const subject = gpu ? "GPU process" : "Window renderer";
      const info = {
        message: `${subject} gone: ${safeToken(reason) || "unknown"}`,
        stack: `exit code ${safeToken(exitCode) || "—"}`,
      };
      return reporter.capture(info, { kind: gpu ? "GpuProcessGone" : "RendererGone", source: "main" });
    },
    hang(details = {}) {
      const { type, ms, channels, top, text } = details;
      const entry = HANG_KINDS.get(type);
      if (!entry) return false;
      const description = entry.describe({ ms, channels, top, text });
      return reporter.capture(description, { kind: entry.kind, source: "main" });
    },
    installId: () => installId,
  };
}

export function startErrorReporting(settings) {
  const reporting = createMainErrorReporting(settings);
  reporting.install(process);
  onHostFailure((failure) => reporting.hostFailure(failure));
  reporting.flush();
  return reporting;
}

// ---------------------------------------------------------------- каналы IPC

export function registerErrorReportingIpc(deps) {
  const { IPC, reporting, trusted, handleIpc } = deps;

  // Обработчик канала: ответ без входа получает только событие, ответ по входу — событие и вход.
  function trustedHandler(answer) {
    if (answer.length === 0) return (event) => trusted(event, answer);
    return (event, input) => trusted(event, () => answer(input));
  }

  // Канал и ответ на него; регистрируются по порядку.
  const answers = [
    [IPC.APP_ERRORS_STATE, () => reporting.getState()],
    [IPC.APP_ERRORS_SET_ENABLED, (input) => reporting.setEnabled(input?.enabled)],
    [IPC.APP_ERRORS_REPORT, (input) => reporting.reportFromRenderer(input)],
  ];
  for (const [channel, answer] of answers) handleIpc(channel, trustedHandler(answer));
}
