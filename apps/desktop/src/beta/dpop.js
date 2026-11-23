import crypto from "node:crypto";

const CURVE = "P-256";
const KEY_TYPE = "EC";

function encodeB64u(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

// Берёт перечисленные поля по порядку; отсутствующие остаются ключами со значением undefined.
function pickFields(source, names) {
  return Object.fromEntries(names.map((name) => [name, source[name]]));
}

export function generateDeviceKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: CURVE });
  const secret = privateKey.export({ format: "jwk" });
  const open = publicKey.export({ format: "jwk" });
  return {
    privateJwk: { kty: KEY_TYPE, crv: CURVE, ...pickFields(secret, ["x", "y", "d"]) },
    publicJwk: { kty: KEY_TYPE, crv: CURVE, ...pickFields(open, ["x", "y"]) },
  };
}

const isText = (value) => typeof value === "string";

// Условия годности: какая половина, какое поле, чем проверить. Идут по порядку, первое невыполненное прерывает.
const DEVICE_KEY_CHECKS = [
  ["priv", "kty", (value) => value === KEY_TYPE],
  ["priv", "crv", (value) => value === CURVE],
  ["priv", "d", isText],
  ["priv", "x", isText],
  ["priv", "y", isText],
  ["pub", "kty", (value) => value === KEY_TYPE],
  ["pub", "crv", (value) => value === CURVE],
  ["pub", "x", (value, halves) => value === halves.priv.x],
  ["pub", "y", (value, halves) => value === halves.priv.y],
];

export function validDeviceKey(key) {
  const { privateJwk: priv, publicJwk: pub } = key ?? {};
  const halves = { priv, pub };
  return DEVICE_KEY_CHECKS.every(([half, field, accept]) => accept(halves[half]?.[field], halves));
}

export function jwkThumbprint(publicJwk) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify({ crv: CURVE, kty: KEY_TYPE, x: publicJwk.x, y: publicJwk.y }));
  return encodeB64u(hash.digest());
}

export function dpopTarget(url) {
  const { origin, pathname } = new URL(url);
  return origin + pathname;
}

// Поля claims вычисляются строго в этом порядке: от него зависит, какая ошибка выйдет первой.
function proofClaims(method, url, nowMs) {
  const jti = crypto.randomUUID();
  const htm = String(method).toUpperCase();
  const htu = dpopTarget(url);
  const iat = Math.floor(nowMs / 1000);
  return { jti, htm, htu, iat };
}

function signEs256(privateJwk, text) {
  const privateKey = crypto.createPrivateKey({ key: privateJwk, format: "jwk" });
  return crypto.sign("sha256", Buffer.from(text), { key: privateKey, dsaEncoding: "ieee-p1363" });
}

export function createDpopProof(key, { method, url, nowMs = Date.now() }) {
  const header = encodeB64u(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: key.publicJwk }));
  const claims = encodeB64u(JSON.stringify(proofClaims(method, url, nowMs)));
  const signed = [header, claims].join(".");
  const signature = signEs256(key.privateJwk, signed);
  return `${signed}.${encodeB64u(signature)}`;
}
