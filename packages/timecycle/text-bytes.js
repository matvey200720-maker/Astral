// Длина текста в байтах UTF-8 — одинаково в Node (через Buffer) и в окне (через TextEncoder).

// Счётчик через TextEncoder решается раз и навсегда при загрузке модуля:
// если TextEncoder появится позже, счёт не изменится.
const encoderCount =
  typeof TextEncoder === "function"
    ? ((encoder) => (text) => encoder.encode(text).length)(new TextEncoder())
    : null;

// Счётчик через Buffer решается на каждом вызове: в окне его нет, в Node он есть всегда.
function bufferCount() {
  const host = globalThis.Buffer;
  return host && typeof host.byteLength === "function" ? (text) => host.byteLength(text, "utf8") : null;
}

// Ни Buffer, ни TextEncoder: единицы UTF-16.
const unitCount = (text) => text.length;

export function textBytes(value) {
  const text = String(value ?? "");
  const count = bufferCount() ?? encoderCount ?? unitCount;
  return count(text);
}
