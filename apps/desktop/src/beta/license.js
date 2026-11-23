import crypto from "node:crypto";

const LIMITS = Object.freeze({
  origin: 256,
  tokenMin: 16,
  tokenMax: 4096,
  signatureBytes: 64,
  keyBytes: 32,
  serial: 32,
});

// DER SubjectPublicKeyInfo для Ed25519: за этим префиксом идут 32 байта ключа.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const TOKEN_PART = /^[A-Za-z0-9_-]+$/;
const ACTIVATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MACHINE_HASH = /^[0-9a-f]{64}$/;

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

// Допуск по схеме: https всегда, http только для loopback и только по явному разрешению.
const SCHEME_GATES = new Map([
  ["https:", () => true],
  ["http:", (url, allowLoopbackHttp) => Boolean(allowLoopbackHttp) && LOOPBACK_HOSTS.includes(url.hostname)],
]);

// Всё, что не должно быть в адресе API (после разбора URL): любое срабатывание отвергает адрес.
const ORIGIN_VETOES = [
  (url) => url.username || url.password,
  (url) => url.search || url.hash,
  (url) => url.pathname !== "/" && url.pathname !== "",
];

// Поля содержимого лицензии: имя в ответе и имя в токене, в порядке ответа.
const GRANT_FIELDS = [
  ["version", "v"],
  ["activationId", "aid"],
  ["machineHash", "mh"],
  ["serial", "serial"],
  ["issuedAt", "iat"],
];

// Условия на содержимое по порядку; второй аргумент — уже нормализованный адрес API.
const CLAIM_RULES = [
  (claims) => claims?.v === 1,
  (claims) => typeof claims.aid === "string" && ACTIVATION_ID.test(claims.aid),
  (claims) => typeof claims.mh === "string" && MACHINE_HASH.test(claims.mh),
  (claims) => typeof claims.serial === "string" && claims.serial.length >= 1 && claims.serial.length <= LIMITS.serial,
  (claims) => Number.isSafeInteger(claims.iat),
  (claims, apiOrigin) => Boolean(apiOrigin),
];

function parseUrl(text) {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

export function normalizeApiOrigin(value, { allowLoopbackHttp = false } = {}) {
  const url = typeof value === "string" && value.length <= LIMITS.origin ? parseUrl(value) : null;
  if (url === null) {
    return null;
  }
  const gate = SCHEME_GATES.get(url.protocol);
  if (gate === undefined) {
    return null;
  }
  const admitted = gate(url, allowLoopbackHttp) && !ORIGIN_VETOES.some((veto) => veto(url));
  return admitted ? url.origin : null;
}

const refuse = (reason) => ({ ok: false, reason });

// Две непустые части из безопасного алфавита; длина считается до обрезки. Иначе null.
function tokenPieces(token) {
  if (typeof token !== "string" || token.length < LIMITS.tokenMin || token.length > LIMITS.tokenMax) {
    return null;
  }
  const pieces = token.trim().split(".");
  return pieces.length === 2 && pieces.every((piece) => TOKEN_PART.test(piece)) ? pieces : null;
}

function verifyEd25519(rawKey, text, signature) {
  try {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(text, "ascii"), key, signature);
  } catch {
    return false;
  }
}

function decodeClaims(payloadText) {
  try {
    return { value: JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8")) };
  } catch {
    return null;
  }
}

function grant(claims, apiOrigin) {
  const fields = Object.fromEntries(GRANT_FIELDS.map(([name, source]) => [name, claims[source]]));
  return { ok: true, claims: { ...fields, apiOrigin } };
}

export function verifyLicense(token, publicKey, options = {}) {
  const pieces = tokenPieces(token);
  if (pieces === null) {
    return refuse("malformed");
  }
  const [payloadText, signatureText] = pieces;

  const signature = Buffer.from(signatureText, "base64url");
  const sizesFit = signature.length === LIMITS.signatureBytes
    && Buffer.isBuffer(publicKey)
    && publicKey.length === LIMITS.keyBytes;
  if (!sizesFit || !verifyEd25519(publicKey, payloadText, signature)) {
    return refuse("signature");
  }

  const decoded = decodeClaims(payloadText);
  if (decoded === null) {
    return refuse("claims");
  }
  const claims = decoded.value;
  const apiOrigin = normalizeApiOrigin(claims?.api, options);
  return CLAIM_RULES.every((rule) => rule(claims, apiOrigin)) ? grant(claims, apiOrigin) : refuse("claims");
}
