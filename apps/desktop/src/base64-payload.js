/*
 * Тело data URL (base64) от окна → байты, с проверкой ДО декодирования
 * (проверка границ доверия, ТЗ 17.10.2026): длина не больше того, во что
 * вырастет предел в байтах, только знаки base64 и каноничная запись (то, что
 * дал бы сам `Buffer.toString("base64")`). Раньше `Buffer.from(…, "base64")`
 * шёл первым: он молча отбрасывает лишние знаки и копирует любую длину, а предел
 * сравнивался уже с результатом. Тот же порядок, что у `decodeMinimapImage`.
 */

/** Сколько знаков base64 даёт `bytes` байт (с добавкой до кратного четырём). */
export const base64Length = (bytes) => Math.ceil(bytes / 3) * 4;

/**
 * `{ bytes }` либо `{ error }`: `"empty"` — пусто, `"large"` — длиннее предела,
 * `"format"` — не каноничный base64.
 */
export function decodeBase64Payload(encoded, maxBytes) {
  if (typeof encoded !== "string" || !encoded.length) return { error: "empty" };
  if (encoded.length > base64Length(maxBytes)) return { error: "large" };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return { error: "format" };
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) return { error: "empty" };
  if (bytes.length > maxBytes) return { error: "large" };
  if (bytes.toString("base64") !== encoded) return { error: "format" };
  return { bytes };
}
