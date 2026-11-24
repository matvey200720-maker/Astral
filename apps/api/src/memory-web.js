// Выдача файлов интерфейса из памяти (бета-сборка): точные пути, Range, подстановка index.html.
import { timingSafeEqual } from "node:crypto";

export const SHELL_HEADER = "x-astral-shell";

const API_PREFIX = "/api/";
const BANNED_KEY_CHARS = ["\0", "\\"];

// Заголовки каждой выдачи после Content-Type — всегда в этом порядке.
const STANDING_HEADERS = [
  ["Cache-Control", "no-store"],
  ["X-Content-Type-Options", "nosniff"],
  ["Accept-Ranges", "bytes"],
];

function tryDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

const isPlainSegment = (part) => part.length > 0 && !part.startsWith(".");

// Путь запроса → ключ набора: без точечных частей, пустых частей и обратных косых.
export function bundleKey(requestPath) {
  const decoded = tryDecode(String(requestPath));
  if (decoded === null || BANNED_KEY_CHARS.some((ch) => decoded.includes(ch))) return null;
  const key = decoded.replace(/^\/+/, "");
  if (key === "") return "";
  return key.split("/").every(isPlainSegment) ? key : null;
}

// Значение Range, если оно целиком «bytes=N-M» хотя бы с одной цифровой частью.
function parseRange(header) {
  const found = typeof header === "string" ? /^bytes=(\d*)-(\d*)$/.exec(header) : null;
  return found && (found[1] || found[2]) ? { head: found[1], tail: found[2] } : null;
}

function spanOf(size, { head, tail }) {
  const last = size - 1;
  if (head === "") return { start: Math.max(0, size - Number(tail)), end: last };
  return { start: Number(head), end: tail === "" ? last : Math.min(Number(tail), last) };
}

const fits = (size, { start, end }) => Number.isSafeInteger(start) && start < size && start <= end;

// Что отвечать на Range: статус, дополнительные заголовки, отрезок тела.
function planReply(rangeHeader, size) {
  const asked = parseRange(rangeHeader);
  if (!asked) return { headers: [["Content-Length", String(size)]], span: null, bodiless: false };
  const span = spanOf(size, asked);
  if (!fits(size, span)) return { status: 416, headers: [["Content-Range", `bytes */${size}`]], span: null, bodiless: true };
  return {
    status: 206,
    headers: [
      ["Content-Range", `bytes ${span.start}-${span.end}/${size}`],
      ["Content-Length", String(span.end - span.start + 1)],
    ],
    span,
    bodiless: false,
  };
}

// Источник тела: байты в памяти либо чтение по требованию.
function bodyReader(entry) {
  return entry.data
    ? { whole: () => entry.data, part: (from, to) => entry.data.subarray(from, to + 1) }
    : { whole: () => entry.load(), part: (from, to) => entry.read(from, to) };
}

const isThenable = (value) => typeof value?.then === "function";

function reportBroken(response) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  ["Content-Length", "Content-Range", "Accept-Ranges"].forEach((name) => response.removeHeader(name));
  response.status(500).json({ error: "Интерфейс повреждён." });
}

const endWith = (response, body) =>
  isThenable(body) ? body.then((bytes) => response.end(bytes), () => reportBroken(response)) : response.end(body);

function respond(request, response, entry) {
  const size = entry.data ? entry.data.length : entry.size;
  response.setHeader("Content-Type", entry.type);
  for (const [name, value] of STANDING_HEADERS) response.setHeader(name, value);

  const plan = planReply(request.headers?.range, size);
  if (plan.status) response.status(plan.status);
  for (const [name, value] of plan.headers) response.setHeader(name, value);
  if (plan.bodiless || request.method === "HEAD") {
    response.end();
    return;
  }
  const reader = bodyReader(entry);
  endWith(response, plan.span ? reader.part(plan.span.start, plan.span.end) : reader.whole());
}

export function secretsMatch(given, expected) {
  if (typeof given !== "string") return false;
  const [ours, theirs] = [expected, given].map((text) => Buffer.from(text));
  return ours.length === theirs.length && timingSafeEqual(ours, theirs);
}

const toFileMap = (source) => (source instanceof Map ? source : new Map(Object.entries(source ?? {})));

export function createMemoryWeb() {
  const state = { files: null, secret: "" };

  // Ключ запуска проверяется только для найденной записи.
  const handOut = (request, response, entry) => {
    if (state.secret && !secretsMatch(request.headers?.[SHELL_HEADER], state.secret)) {
      response.status(404).json({ error: "Маршрут не найден." });
      return;
    }
    respond(request, response, entry);
  };

  const PASS_THROUGH_FILES = [
    () => !state.files,
    (request) => request.method !== "GET" && request.method !== "HEAD",
    (request) => request.path.startsWith(API_PREFIX),
  ];

  const PASS_THROUGH_PAGES = [
    () => !state.files,
    (request) => request.method !== "GET",
    (request) => request.path.startsWith(API_PREFIX),
    (request) => !String(request.headers?.accept ?? "").includes("text/html"),
  ];

  return {
    use(bundleFiles, { accessToken } = {}) {
      state.files = toFileMap(bundleFiles);
      state.secret = String(accessToken ?? "");
    },
    clear() {
      state.files = null;
      state.secret = "";
    },
    middleware(request, response, next) {
      if (PASS_THROUGH_FILES.some((skips) => skips(request))) return next();
      const key = bundleKey(request.path);
      const entry = key ? state.files.get(key) : undefined;
      return entry ? handOut(request, response, entry) : next();
    },
    spaFallback(request, response, next) {
      if (PASS_THROUGH_PAGES.some((skips) => skips(request))) return next();
      const page = state.files.get("index.html");
      return page ? handOut(request, response, page) : next();
    },
    active() {
      return state.files !== null;
    },
  };
}
