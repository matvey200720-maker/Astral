const ELLIPSIS = "…";
const DEFAULT_MAX = 36;
const SEGMENT_BREAK = new RegExp("[\\\\/]");
const DRIVE_PREFIX = new RegExp("^([A-Za-z]):[\\\\/]");

// Ложное значение — пустой путь, остальное читается строкой обычным правилом.
function asText(value) {
  return value ? String(value) : "";
}

export function middlePath(path, max = DEFAULT_MAX) {
  const text = asText(path);
  const segments = text.split(SEGMENT_BREAK);
  if (text.length <= max || segments.length <= 3) return text;

  // Одной обратной черты в пути достаточно, чтобы склеивать обратной.
  const glue = text.includes("\\") ? "\\" : "/";
  const shortened = (tailSize) => [...segments.slice(0, 2), ELLIPSIS, ...segments.slice(-tailSize)].join(glue);

  const wide = shortened(2);
  // Вариант с одной папкой по длине не проверяется: он берётся всегда.
  return wide.length <= max ? wide : shortened(1);
}

export function driveOf(path) {
  const [, letter] = DRIVE_PREFIX.exec(asText(path)) ?? [];
  return letter ? `${letter.toUpperCase()}:` : "";
}
