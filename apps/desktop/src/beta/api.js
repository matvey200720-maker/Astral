// apps/desktop/src/beta/api.js
// Клиент HTTP-API бета-доступа: подпись запросов DPoP, поправка часов по 401,
// разбор ответов bind/unlock в вердикт («стереть», «остановиться», «не знаем»).

import { createDpopProof } from "./dpop.js";

export const API_PREFIX = "/api/v1/beta/";

const frozenTable = (pairs) => Object.freeze(Object.fromEntries(pairs));

// Код сервера → причина самоудаления (ответ 403).
export const SELF_DESTRUCT_CODES = frozenTable([
  ["BETA_ACTIVATION_REVOKED", "server_revoked"],
  ["BETA_DEVICE_MISMATCH", "server_device_mismatch"],
  ["BETA_MACHINE_MISMATCH", "server_machine_mismatch"],
  ["BETA_BIND_CONFLICT", "server_bind_conflict"],
  ["BETA_ACCOUNT_SHARED", "server_account_shared"],
  ["BETA_ACTIVATION_REPLACED", "server_replaced"],
]);

// Код сервера → причина остановки без стирания (ответ 403 или 404).
export const BLOCKING_CODES = frozenTable([
  ["BETA_ACTIVATION_UNKNOWN", "unknown_activation"],
  ["BETA_BIND_INVALID", "bind_invalid"],
]);

export const VERDICTS_HEADER = "astral-beta-verdicts";
export const VERDICTS_VERSION = "2";

const PROBLEM_BODY_CAP = 65536;
const CLOCK_SANITY_MS = 86_400_000;
const CLOCK_JITTER_MS = 5000;
const TTL_FLOOR = 60;
const TTL_CEILING = 604_800;
const PAK_KEY_LENGTH = 43;
const URL_SAFE_SYMBOLS = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");

const looksLikePakKey = (text) =>
  typeof text === "string" && text.length === PAK_KEY_LENGTH && [...text].every((ch) => URL_SAFE_SYMBOLS.has(ch));

const isChannelName = (item) =>
  typeof item === "string" && item.length >= 1 && item.length <= 16 && [...item].every((ch) => ch >= "a" && ch <= "z");

const declaredSize = (response) => {
  const asNumber = Number(response.headers.get("content-length"));
  return Number.isFinite(asNumber) ? asNumber : 0;
};

async function pullText(response) {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

export async function readProblemCode(response) {
  const mediaType = String(response.headers.get("content-type") ?? "");
  if (!mediaType.toLowerCase().includes("json")) return null;
  if (declaredSize(response) > PROBLEM_BODY_CAP) return null;

  const raw = await pullText(response);
  if (raw === null || raw.length > PROBLEM_BODY_CAP) return null;

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  const code = doc?.code;
  return typeof code === "string" ? code : null;
}

const STATUS_REASONS = new Map([
  [401, "proof"],
  [429, "rate_limited"],
]);

const transientReason = (status) => STATUS_REASONS.get(status) ?? (status >= 500 ? "server" : "unexpected");

// Вердикты по таблицам кодов: (статусы, таблица, вид).
const CODE_RULES = [
  [[403], SELF_DESTRUCT_CODES, "destroy"],
  [[403, 404], BLOCKING_CODES, "blocked"],
];

export async function verdictOf(response) {
  if (response.ok) return { kind: "ok" };

  const code = await readProblemCode(response.clone());
  const { status } = response;
  for (const [statuses, table, kind] of CODE_RULES) {
    const reason = table[code];
    if (statuses.includes(status) && reason !== undefined) return { kind, reason, code };
  }
  return { kind: "transient", reason: transientReason(status), status, code };
}

// Тело, которое можно безопасно послать второй раз (после поправки часов).
const REPLAYABLE_CLASSES = [URLSearchParams, ArrayBuffer];

function isResendableBody(body) {
  if (body == null || typeof body === "string") return true;
  return ArrayBuffer.isView(body) || REPLAYABLE_CLASSES.some((cls) => body instanceof cls);
}

function parseLauncherOk(doc) {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const { pak_key: keyText, serial, check_ttl: ttl, channels } = doc;

  const ttlOk = Number.isSafeInteger(ttl) && ttl >= TTL_FLOOR;
  if (!looksLikePakKey(keyText) || typeof serial !== "string" || !ttlOk) return null;

  const pakKey = Buffer.from(keyText, "base64url");
  if (pakKey.length !== 32) return null; // недостижимо: 43 знака base64url всегда дают 32 байта

  return {
    kind: "ok",
    pakKey,
    serial,
    checkTtlSeconds: Math.min(ttl, TTL_CEILING),
    channels: Array.isArray(channels) ? channels.filter(isChannelName) : [],
  };
}

async function dropBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // тело прежнего ответа не нужно: ошибка отмены не мешает повтору
  }
}

// Значения по умолчанию подставляются только вместо undefined.
const CLIENT_FALLBACKS = { now: Date.now, userAgent: "AstralBeta", headersTimeoutMs: 10000 };

class BetaApiClient {
  #origin;
  #getKey;
  #fetchImpl;
  #now;
  #userAgent;
  #headersTimeoutMs;
  #skew = 0;

  constructor(options) {
    const given = (key) => (options[key] === undefined ? CLIENT_FALLBACKS[key] : options[key]);
    this.#origin = options.origin;
    this.#getKey = options.getKey;
    this.#fetchImpl = options.fetchImpl;
    this.#now = given("now");
    this.#userAgent = given("userAgent");
    this.#headersTimeoutMs = given("headersTimeoutMs");
  }

  skewMs() {
    return this.#skew;
  }

  resolve(pathOrUrl) {
    const target = new URL(pathOrUrl, this.#origin);
    const foreign = target.origin !== this.#origin || Boolean(target.username || target.password);
    if (foreign) throw new TypeError("beta API request must stay on the API origin");
    if (!target.pathname.startsWith(API_PREFIX)) {
      throw new TypeError("beta API path must start with /api/v1/beta/");
    }
    return target;
  }

  #deliver(href, init) {
    return this.#fetchImpl ? this.#fetchImpl(href, init) : fetch(href, init);
  }

  #signedHeaders(source, method, url) {
    const headers = new Headers(source);
    const proof = createDpopProof(this.#getKey(), { method, url: url.href, nowMs: this.#now() + this.#skew });
    headers.set("DPoP", proof);
    headers.set(VERDICTS_HEADER, VERDICTS_VERSION);
    if (!headers.has("user-agent")) headers.set("user-agent", this.#userAgent);
    return headers;
  }

  #armDeadline(timeoutMs, callerSignal) {
    const expiry = new AbortController();
    const timer = setTimeout(() => {
      expiry.abort(new DOMException("beta API did not answer in time", "TimeoutError"));
    }, timeoutMs);
    const sources = callerSignal ? [expiry.signal, callerSignal] : [expiry.signal];
    return { signal: AbortSignal.any(sources), disarm: () => clearTimeout(timer) };
  }

  // Расхождение часов, если оно правдоподобно и заметно отличается от прежней поправки.
  #measureDrift(response) {
    const stamp = response.headers.get("date");
    const serverTime = stamp ? Date.parse(stamp) : Number.NaN;
    if (Number.isNaN(serverTime)) return null;

    const drift = serverTime - this.#now();
    const plausible = Math.abs(drift) < CLOCK_SANITY_MS;
    const noticeable = Math.abs(drift - this.#skew) > CLOCK_JITTER_MS;
    return plausible && noticeable ? drift : null;
  }

  async send(pathOrUrl, init = {}, flags = {}) {
    const retried = flags.retried === undefined ? false : flags.retried;
    const timeoutMs = flags.timeoutMs === undefined ? this.#headersTimeoutMs : flags.timeoutMs;
    const url = this.resolve(pathOrUrl);
    const method = String(init.method || "GET").toUpperCase();
    const headers = this.#signedHeaders(init.headers, method, url);
    const { signal, disarm } = this.#armDeadline(timeoutMs, init.signal);

    const passthrough = { ...init };
    for (const own of ["method", "headers", "signal", "redirect"]) delete passthrough[own];

    let response;
    try {
      response = await this.#deliver(url.href, { ...passthrough, method, headers, signal, redirect: "error" });
    } finally {
      disarm();
    }

    if (retried || response.status !== 401 || !isResendableBody(init.body)) return response;
    const drift = this.#measureDrift(response);
    if (drift === null) return response;

    this.#skew = drift;
    await dropBody(response);
    return this.send(pathOrUrl, init, { retried: true, timeoutMs });
  }

  async #readLauncherSuccess(response) {
    const unusable = { kind: "transient", reason: "unexpected", status: 200 };
    let doc;
    try {
      doc = await response.json();
    } catch {
      return unusable;
    }
    return parseLauncherOk(doc) ?? unusable;
  }

  async #readLauncherOther(response) {
    const verdict = await verdictOf(response);
    const badRequest = verdict.kind === "transient" && verdict.status === 400;
    return badRequest ? { kind: "blocked", reason: "bad_request", code: verdict.code ?? undefined } : verdict;
  }

  async launcher(mode, body, flags = {}) {
    const timeoutMs = flags.timeoutMs === undefined ? this.#headersTimeoutMs : flags.timeoutMs;
    const request = {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    };
    let response;
    try {
      response = await this.send(`${API_PREFIX}launcher/${mode}`, request, { timeoutMs });
    } catch (error) {
      return { kind: "transient", reason: "network", error };
    }
    return response.status === 200 ? this.#readLauncherSuccess(response) : this.#readLauncherOther(response);
  }
}

export function createBetaApi(options) {
  const client = new BetaApiClient(options);
  return {
    send: (...args) => client.send(...args),
    launcher: (...args) => client.launcher(...args),
    resolve: (target) => client.resolve(target),
    skewMs: () => client.skewMs(),
  };
}
