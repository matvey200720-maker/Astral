const maximumResponseBytes = 2 * 1024 * 1024 + 16 * 1024;
const maximumArtifactBytes = 10 * 1024 * 1024 * 1024;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const keyIDPattern = /^[A-Za-z0-9._-]{1,64}$/;
const signaturePattern = /^[A-Za-z0-9+/]{86}==$/;

/*
 * Выдача ссылки не годится. `status` — HTTP-статус ответа сервера (429 — предел выдачи, 403/401 — доступ, 201 — ответ пришёл, но тело или срок негодны), `reason` — слово изъяна
 * при 201 (`body`, `expiry`). Они стоят в тексте («… unavailable (HTTP 429).»): через мост Electron свойства ошибки теряются, текст доходит до журнала и до окна (23.11.2026: двенадцать
 * одинаковых «unavailable» в журнале владельца не говорили, что это предел 30 ссылок в минуту).
 */
export class DownloadGrantV1Error extends Error {
  constructor(detail = {}) {
    const { status = null, reason = "" } = typeof detail === "object" && detail ? detail : {};
    const parts = [Number.isInteger(status) ? `HTTP ${status}` : "", reason].filter(Boolean);
    /* Прежняя сигнатура брала готовую строку сообщения — она по-прежнему сообщение. */
    super(typeof detail === "string" && detail ? detail : `Astral download grant is unavailable${parts.length ? ` (${parts.join(", ")})` : ""}.`);
    this.name = "DownloadGrantV1Error";
    this.code = "INVALID_DOWNLOAD_GRANT_V1";
    this.status = Number.isInteger(status) ? status : null;
    this.reason = String(reason || "");
  }
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...expected].sort().join(",")
  );
}

async function readBoundedText(response) {
  const declared = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maximumResponseBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new DownloadGrantV1Error();
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumResponseBytes) {
      throw new DownloadGrantV1Error();
    }
    return text;
  }
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumResponseBytes) {
      await reader.cancel().catch(() => {});
      throw new DownloadGrantV1Error();
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, length),
    );
  } catch {
    throw new DownloadGrantV1Error();
  }
}

function validPackageURL(raw, digest) {
  try {
    const value = new URL(raw);
    const expectedPath = `/sha256/${digest}/`;
    const hostname = value.hostname.toLowerCase();
    return (
      value.protocol === "https:" &&
      !value.username &&
      !value.password &&
      !value.port &&
      !value.search &&
      !value.hash &&
      hostname !== "localhost" &&
      !hostname.includes(":") &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) &&
      value.pathname === expectedPath &&
      value.href === `${value.origin}${expectedPath}`
    );
  } catch {
    return false;
  }
}

/** Ответ выдачи ссылки; любой изъян — `DownloadGrantV1Error` со статусом ответа (429 против остального). */
export async function parseDownloadGrantV1Response(response, options) {
  try {
    return await parseGrant(response, options);
  } catch (error) {
    if (error instanceof DownloadGrantV1Error && error.status === null)
      throw new DownloadGrantV1Error({ status: response?.status, reason: error.reason });
    throw error;
  }
}

async function parseGrant(
  response,
  { now = () => Date.now() } = {},
) {
  const contentType = String(response?.headers?.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    !response ||
    response.status !== 201 ||
    contentType !== "application/json"
  ) {
    await response?.body?.cancel?.().catch(() => {});
    throw new DownloadGrantV1Error();
  }
  const text = await readBoundedText(response);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new DownloadGrantV1Error();
  }
  if (
    !exactKeys(payload, [
      "grant_token",
      "expires_at",
      "package_base_url",
      "bytes",
      "sha256",
      "signing_key_id",
      "manifest",
      "release_id",
    ]) ||
    !tokenPattern.test(payload.grant_token || "") ||
    !digestPattern.test(payload.sha256 || "") ||
    !uuidPattern.test(payload.release_id || "") ||
    !keyIDPattern.test(payload.signing_key_id || "") ||
    !Number.isSafeInteger(payload.bytes) ||
    payload.bytes < 1 ||
    payload.bytes > maximumArtifactBytes ||
    !exactKeys(payload.manifest, Object.keys(payload.manifest || {})) ||
    !signaturePattern.test(payload.manifest?.signature || "") ||
    Buffer.from(payload.manifest.signature, "base64").length !== 64 ||
    !validPackageURL(payload.package_base_url, payload.sha256)
  ) {
    throw new DownloadGrantV1Error({ reason: "body" });
  }
  const expiresAt = Date.parse(payload.expires_at || "");
  /* Срок ссылки меряется по часам сервера (заголовок `Date`), а не компьютера (31.10.2026, журнал
     тестера: часы позади облака на 120 мин, сервер ответил 201, а окно видело ссылку на 2 ч 5 мин и
     отвечало «grant is unavailable» на каждый мод). Заголовка нет — свои часы. */
  const serverNow = Date.parse(response.headers.get("date") || "");
  const current = Number.isFinite(serverNow) ? serverNow : now();
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= current ||
    expiresAt > current + 5 * 60_000 + 10_000
  ) {
    throw new DownloadGrantV1Error({ reason: "expiry" });
  }
  const manifestBytes = Buffer.byteLength(
    JSON.stringify(payload.manifest),
    "utf8",
  );
  if (manifestBytes < 2 || manifestBytes > 2 * 1024 * 1024) {
    throw new DownloadGrantV1Error();
  }
  return Object.freeze({
    manifest: payload.manifest,
    packageBaseUrl: payload.package_base_url,
    bytes: payload.bytes,
    sha256: payload.sha256,
    signingKeyId: payload.signing_key_id,
    expiresAt: payload.expires_at,
    /* Сколько ссылка ещё живёт: это число от часов не зависит, в отличие от `expiresAt`. */
    validForMs: expiresAt - current,
    releaseId: payload.release_id,
  });
}
