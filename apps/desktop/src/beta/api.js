// apps/desktop/src/beta/api.js
// Клиент HTTP-API бета-доступа: подпись запросов DPoP, поправка часов по 401,
// разбор ответов bind/unlock в вердикт («доступ отозван», «остановиться», «не знаем»).
//
// Ни один вердикт ничего не стирает (решение владельца 23.11.2026): отзыв доступа — это окно
// и выход. Отзыв принимается только с подписью сервера (ключ лицензии, вшит в сборку),
// привязанной к этому самому запросу: кто просил (ключ устройства), какой запрос (jti),
// каким методом и куда, что в нём было (сумма тела). Ответ без такой подписи — «не знаем»:
// лаунчер работает по кэшу ключа, как при сбое сети.

import crypto from "node:crypto";
import { createDpopProof, dpopTarget, jwkThumbprint } from "./dpop.js";

export const API_PREFIX = "/api/v1/beta/";

const frozenTable = (pairs) => Object.freeze(Object.fromEntries(pairs));

// Код сервера → причина «доступ отозван» (ответ 403 с подписью сервера): окно и выход, файлы остаются.
export const REVOKING_CODES = frozenTable([
  ["BETA_ACTIVATION_REVOKED", "server_revoked"],
  ["BETA_DEVICE_MISMATCH", "server_device_mismatch"],
  ["BETA_MACHINE_MISMATCH", "server_machine_mismatch"],
  ["BETA_BIND_CONFLICT", "server_bind_conflict"],
  ["BETA_ACCOUNT_SHARED", "server_account_shared"],
  ["BETA_ACTIVATION_REPLACED", "server_replaced"],
]);

// Код сервера → причина остановки с просьбой поставить заново (ответ 403 или 404).
export const BLOCKING_CODES = frozenTable([
  ["BETA_ACTIVATION_UNKNOWN", "unknown_activation"],
  ["BETA_BIND_INVALID", "bind_invalid"],
]);

/*
 * Уровень лаунчера в заголовке каждого запроса беты. Сервер по нему решает, что этому лаунчеру можно отдать:
 *   2 — знает отказы BETA_ACCOUNT_SHARED и BETA_ACTIVATION_REPLACED (прежним вместо них идёт «доступ отозван»);
 *   3 — к тому же НИЧЕГО НЕ СТИРАЕТ: по подписанному отказу только закрывает доступ (окно и выход). Подписанный
 *       отказ сервер отдаёт только уровню 3 и выше: лаунчер 1.0.5 (уровень 2) по подписи стирал установку, и
 *       подпись ему уходить не должна.
 * Поднимать уровень можно только сборке, в которой стирания нет (сторож — tests/beta-no-erase.test.js). На то, как
 * сам лаунчер разбирает ответ, уровень не влияет: без подписи отказ остаётся «не знаем», с подписью — «доступ закрыт».
 */
export const VERDICTS_HEADER = "astral-beta-verdicts";
export const VERDICTS_VERSION = "3";

// Подпись вердикта «доступ отозван»: base64url(JSON) + «.» + подпись Ed25519 ключом лицензии над текстом
// «метка + первая часть». Метка отделяет эту подпись от подписи самой лицензии: одно за другое не выдать.
export const VERDICT_SIGNATURE_HEADER = "astral-beta-verdict-sig";
export const VERDICT_TOKEN_TYPE = "astral-beta-verdict";
export const VERDICT_SIGNING_LABEL = "astral-beta-verdict\n";
const VERDICT_TOKEN_CAP = 2048;
const VERDICT_TOKEN_PART = /^[A-Za-z0-9_-]+$/;
const SIGNATURE_BYTES = 64;
const PUBLIC_KEY_BYTES = 32;
// DER SubjectPublicKeyInfo для Ed25519: за этим префиксом идут 32 байта ключа.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// Что лаунчер отправил в запросе, на который пришёл этот ответ: с этим сверяется подписанный вердикт.
const SENT_REQUESTS = new WeakMap();

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
  [[403], REVOKING_CODES, "revoked"],
  [[403, 404], BLOCKING_CODES, "blocked"],
];

// Байты тела запроса так, как они уйдут в сеть; null — тело не пересчитать (поток, Blob, FormData).
function requestBodyBytes(body) {
  if (body == null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf8");
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return null;
}

function requestBodyHash(body) {
  const bytes = requestBodyBytes(body);
  return bytes === null ? null : crypto.createHash("sha256").update(bytes).digest("hex");
}

// Содержимое подписанного вердикта, если подпись сделана ключом лицензии; иначе null.
function signedVerdictClaims(token, rawKey) {
  if (typeof token !== "string" || token.length > VERDICT_TOKEN_CAP) return null;
  if (!Buffer.isBuffer(rawKey) || rawKey.length !== PUBLIC_KEY_BYTES) return null;

  const pieces = token.trim().split(".");
  if (pieces.length !== 2 || !pieces.every((piece) => VERDICT_TOKEN_PART.test(piece))) return null;
  const [payloadText, signatureText] = pieces;
  const signature = Buffer.from(signatureText, "base64url");
  if (signature.length !== SIGNATURE_BYTES) return null;

  try {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    const signedText = Buffer.from(VERDICT_SIGNING_LABEL + payloadText, "ascii");
    if (!crypto.verify(null, signedText, key, signature)) return null;
    const claims = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
    return claims !== null && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

// Отзыв доказан: подпись сервера стоит на этом коде и на этом самом запросе —
// кто просил (jkt), какой запрос (jti), каким методом и куда (htm, htu), что в нём было (bh).
function revocationIsProven(response, code) {
  const sent = SENT_REQUESTS.get(response);
  if (!sent || sent.bodyHash === null) return false;

  const claims = signedVerdictClaims(response.headers.get(VERDICT_SIGNATURE_HEADER), sent.verdictKey);
  if (claims === null) return false;
  return (
    claims.t === VERDICT_TOKEN_TYPE &&
    claims.v === 1 &&
    claims.code === code &&
    claims.jkt === sent.jkt &&
    claims.jti === sent.jti &&
    claims.htm === sent.method &&
    claims.htu === sent.target &&
    claims.bh === sent.bodyHash
  );
}

export async function verdictOf(response) {
  if (response.ok) return { kind: "ok" };

  const code = await readProblemCode(response.clone());
  const { status } = response;
  for (const [statuses, table, kind] of CODE_RULES) {
    // Только свои записи таблицы: код вроде «toString» не должен найти унаследованное свойство.
    if (!statuses.includes(status) || typeof code !== "string" || !Object.hasOwn(table, code)) continue;
    const reason = table[code];
    // Ответ без подписи сервера не доказывает его решения: это «не знаем», доступ не отзывается.
    if (kind === "revoked" && !revocationIsProven(response, code)) {
      return { kind: "transient", reason: "unverified", status, code };
    }
    return { kind, reason, code };
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
  #verdictKey;
  #skew = 0;

  constructor(options) {
    const given = (key) => (options[key] === undefined ? CLIENT_FALLBACKS[key] : options[key]);
    this.#origin = options.origin;
    this.#getKey = options.getKey;
    this.#fetchImpl = options.fetchImpl;
    // Открытый ключ лицензии (32 байта): без него подписанный вердикт не проверить, и отзыв доступа не принимается.
    this.#verdictKey = options.verdictKey;
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

  // Заголовки с подтверждением DPoP и то, чем этот запрос опознаётся в подписанном вердикте (ключ и jti).
  #signedHeaders(source, method, url) {
    const headers = new Headers(source);
    const key = this.#getKey();
    const proof = createDpopProof(key, { method, url: url.href, nowMs: this.#now() + this.#skew });
    headers.set("DPoP", proof);
    headers.set(VERDICTS_HEADER, VERDICTS_VERSION);
    if (!headers.has("user-agent")) headers.set("user-agent", this.#userAgent);
    const { jti } = JSON.parse(Buffer.from(proof.split(".")[1], "base64url").toString("utf8"));
    return { headers, jkt: jwkThumbprint(key.publicJwk), jti };
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
    const { headers, jkt, jti } = this.#signedHeaders(init.headers, method, url);
    // Сумма тела снимается до отправки: позже вызывающий мог бы поменять свой массив.
    const sent = {
      verdictKey: this.#verdictKey,
      jkt,
      jti,
      method,
      target: dpopTarget(url.href),
      bodyHash: requestBodyHash(init.body),
    };
    const { signal, disarm } = this.#armDeadline(timeoutMs, init.signal);

    const passthrough = { ...init };
    for (const own of ["method", "headers", "signal", "redirect"]) delete passthrough[own];

    let response;
    try {
      response = await this.#deliver(url.href, { ...passthrough, method, headers, signal, redirect: "error" });
    } finally {
      disarm();
    }
    SENT_REQUESTS.set(response, sent);

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
    if (response.status === 200) return this.#readLauncherSuccess(response);
    // Успех без тела ответа (201, 204, 206…) ключа не несёт: это не «доступ подтверждён», а непонятный ответ.
    if (response.ok) return { kind: "transient", reason: "unexpected", status: response.status };
    return this.#readLauncherOther(response);
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
