import { webBuildStamp } from "./web-build.js";
import { writeCoverFrame, readCoverFrame } from "./cover-frames.js";

const IMAGE_URI_PREFIX = "data:image/";

const ignore = () => undefined;

// Условия записи проверяются по порядку; причину отказа вызывающему знать не нужно.
const WRITE_CONDITIONS = [
  (key) => Boolean(key),
  (key, uri) => typeof uri === "string",
  (key, uri) => uri.startsWith(IMAGE_URI_PREFIX),
];

export function writeTile(key, uri) {
  if (!WRITE_CONDITIONS.every((holds) => holds(key, uri))) return;
  const pending = writeCoverFrame(key, uri);
  pending.catch(ignore);
}

// Ответ хранилища отдаётся как есть; любой сбой, и синхронный тоже, даёт null.
export function readTile(key) {
  const attempt = new Promise((resolve) => resolve(key ? readCoverFrame(key) : null));
  return attempt.catch(() => null);
}

// Ключ несёт метку сборки: новый выпуск не видит старых записей.
export function tileStoreKey(kind, ...parts) {
  if (typeof indexedDB === "undefined") return null;
  const stamp = webBuildStamp();
  return stamp ? "tile:".concat(kind, ":", stamp, "|", parts.join("|")) : null;
}
