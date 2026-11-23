import { createErrorReporter } from "@modovik/contracts/app-errors";

// Отчёты об ошибках окна (Т-130, docs/runbooks/app-errors.md): у страницы нет ключей облака и очереди на диске,
// поэтому слать может только главный процесс через мост. Очистку текста, отпечаток, повторы и пачки держит
// договор, здесь — склейка. Журнал окна (Т-153) пишется всегда, от согласия на отчёты он не зависит.

const noop = () => {};
const attempt = (f, otherwise) => {
  try {
    return f();
  } catch {
    return otherwise;
  }
};

// Состояние окна: страница оболочки, кэш согласия (до ответа главного процесса — «включено»), метка ловушек
let shellPage = "";
let consent = true;
let hooked = false;

// Страница оболочки → путь телеметрии. Таблица обычным объектом: имена из прототипа («constructor») дают
// функцию, в отчёт она не попадает — путь не из списка договора.
const PATHS = {
  overview: "/app",
  catalog: "/app/catalog",
  search: "/app/catalog",
  detail: "/app/catalog",
  workshop: "/app/workshop",
  library: "/app/installed",
  builds: "/app/builds",
  settings: "/app/settings",
};

export const errorPagePath = (page) => (typeof page === "string" ? PATHS[page] : undefined);

export const setErrorPage = (value) => {
  shellPage = String(value || "");
};

// Запись строится внутри attempt: сбой чтения свойств ошибки или моста журнал не роняет
const pushLog = (build) =>
  attempt(() => {
    const bridge = globalThis.window?.modovik;
    if (typeof bridge?.writeAppLog === "function") Promise.resolve(bridge.writeAppLog(build())).catch(noop);
  });

export const writeWindowLog = (entry = {}) => {
  const { level = "info", source = "window", message = "", detail = "" } = entry;
  pushLog(() => ({ level, source, message: String(message).slice(0, 1000), detail: String(detail).slice(0, 6000) }));
};

// Согласие: ответ главного процесса с булевым enabled запоминается; без ответа — запрошенное значение
export const readErrorReportingState = async () => {
  const bridge = globalThis.window?.modovik;
  const reply = bridge?.getErrorReporting && (await bridge.getErrorReporting());
  if (typeof reply?.enabled === "boolean") consent = reply.enabled;
  return { available: !!bridge?.getErrorReporting, enabled: consent };
};

export const setErrorReportingEnabled = async (enabled) => {
  const bridge = globalThis.window?.modovik;
  const reply = bridge?.setErrorReporting && (await bridge.setErrorReporting(enabled === true));
  consent = typeof reply?.enabled === "boolean" ? reply.enabled : enabled === true;
  return { available: !!bridge?.setErrorReporting, enabled: consent };
};

// Отчёты шлём строго по очереди: следующий не начинается, пока мост не ответил на прежний
const deliver = async (events, bridge) => {
  for (const { error } of events) {
    const { kind, message, stack, page } = error;
    await bridge.reportAppError({ kind, message, stack: stack || "", page: page || "" });
  }
};

const reporter = createErrorReporter({
  defaults: { getPage: () => errorPagePath(shellPage), source: "renderer" },
  send: (events) => deliver(events, globalThis.window?.modovik),
  isEnabled: () => consent && typeof globalThis.window?.modovik?.reportAppError === "function",
});

export const flushErrorReports = () => reporter.flush();

export const captureRendererError = (error, options = {}) => {
  const wanted = options.kind;
  pushLog(() =>
    ({ level: "error", source: "window", message: `${wanted || error?.name || "Error"}: ${String(error?.message ?? error).slice(0, 1000)}`, detail: String(error?.stack || "").slice(0, 6000) }),
  );
  return attempt(() => reporter.capture(error, { ...options, source: "renderer" }), false);
};

// Имя файла из адреса скрипта: хвост после / или \, без ?запроса и #якоря
const leafOf = (url) =>
  String(url ?? "")
    .split(/[\\/]/)
    .pop()
    .split(/[?#]/)[0] || "<page>";

export function longFrameReport(frame) {
  const rawMs = Number(frame?.duration);
  const seconds = Number.isFinite(rawMs) ? rawMs / 1000 : 0;
  const slowest = Array.from(frame?.scripts ?? []).sort(
    (left, right) => (right.duration || 0) - (left.duration || 0),
  );

  const lead = slowest.length > 0 ? ` in ${leafOf(slowest[0].sourceURL)}` : "";
  const lines = slowest.slice(0, 3).map((script) => {
    const caller = script.sourceFunctionName || script.invoker || "<anonymous>";
    return `    at ${caller} (${leafOf(script.sourceURL)})`;
  });

  return {
    name: "LongFrame",
    message: `Window frame took ${seconds.toFixed(1)} s${lead}`,
    stack: lines.join("\n"),
  };
}

// Долгие кадры (20.10.2026, зависания): в журнал не чаще раза в 15 с, отчётом — не больше трёх за 10 минут,
// чтобы кадры не вытесняли настоящие ошибки; повтор по отпечатку квоту тоже тратит
export const watchLongFrames = (target = globalThis, clock = Date.now) => {
  const types = target?.PerformanceObserver?.supportedEntryTypes;
  if (!Array.isArray(types) || !types.includes("long-animation-frame")) return noop;
  const seen = { log: -Infinity, reports: [] };
  const consider = (entry) => {
    if (entry.duration < 1000) return;
    const frame = longFrameReport(entry);
    const now = clock();
    if (seen.log + 15000 <= now) {
      seen.log = now;
      writeWindowLog({ level: "warn", message: `${frame.message}; страница: ${shellPage || "—"}`, detail: frame.stack });
    }
    // третье с конца событие должно выйти из окна в 10 минут
    if (seen.reports.length >= 3 && now - seen.reports.at(-3) < 600000) return;
    seen.reports = [...seen.reports.slice(-2), now];
    attempt(() => reporter.capture(frame, { kind: "LongFrame", source: "renderer" }));
  };
  return attempt(() => {
    const watcher = new target.PerformanceObserver((list) => list.getEntries().forEach(consider));
    watcher.observe({ type: "long-animation-frame", buffered: false });
    return () => watcher.disconnect();
  }, noop);
};

/* Шум браузера, не ошибка: колбэки ResizeObserver за кадр породили ещё перемеры — браузер доставит их в следующем кадре (то же отсеивает сайт, `site-error-reporter.js`). */
const isBrowserNoise = (message) => /resizeobserver loop/i.test(String(message ?? ""));

const onPageError = ({ error, message }) => {
  if (!error && (!message || message === "Script error." || isBrowserNoise(message))) return;
  const failure = error || new Error(message);
  captureRendererError(failure, { kind: failure.name || "Error" });
};

const onRejection = ({ reason }) => {
  const failure = reason instanceof Error ? reason : new Error(String(reason));
  captureRendererError(failure, { kind: "unhandledrejection" });
};

export const installRendererErrorCapture = (target = window) => {
  if (hooked) return noop;
  hooked = true;
  target.addEventListener("error", onPageError);
  target.addEventListener("unhandledrejection", onRejection);
  readErrorReportingState().catch(noop);
  return () => {
    target.removeEventListener("error", onPageError);
    target.removeEventListener("unhandledrejection", onRejection);
    hooked = false;
  };
};
