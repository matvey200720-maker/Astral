import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionToken({
  userId,
  secret,
  ttlMs,
  now = Date.now(),
}) {
  const id = String(userId || "").trim();
  if (!id || id.length > 128)
    throw new Error("Некорректный пользователь сессии.");
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("Секрет сессии должен содержать минимум 32 байта.");
  }
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl < 60_000) {
    throw new Error("Некорректный срок сессии.");
  }
  const payload = Buffer.from(
    JSON.stringify({
      userId: id,
      issuedAt: now,
      expiresAt: now + ttl,
      sessionId: randomBytes(18).toString("base64url"),
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  try {
    const value = String(token || "");
    if (!secret || Buffer.byteLength(secret) < 32 || value.length > 2048) {
      return null;
    }
    const [payload, received, extra] = value.split(".");
    if (!payload || !received || extra) return null;
    const expected = signature(payload, secret);
    const left = Buffer.from(received);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      return null;
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      !parsed.userId ||
      !parsed.sessionId ||
      !Number.isFinite(parsed.issuedAt) ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.issuedAt > now + 60_000 ||
      parsed.expiresAt <= now ||
      parsed.expiresAt - parsed.issuedAt > 1000 * 60 * 60 * 24 * 31
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
