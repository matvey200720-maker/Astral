export const WORLD_MAP_SCHEMA_VERSION = 1;

export const WORLD_MAP_LIMITS = Object.freeze({
  zones: 600,
  zonePoints: 240,
  markers: 2400,
  emblems: 300,
  strokes: 500,
  strokePoints: 400,
  nameLength: 48,
  textLength: 64,
  emblemText: 240,
  emblemLines: 8,
});

export const BLEND_MODES = Object.freeze([
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "color",
  "hue",
  "lighten",
  "darken",
]);

const MARKER_NAME_LINES = 4;
const HEX_DIGITS = "0123456789abcdef";
const LINE_FEED = 10;

// Значение как строка: пусто только для null и undefined (0 и false остаются «0» и «false»).
const textOf = (value) => (value == null ? "" : String(value));

// Управляющие знаки (0–31 и 127) удаляются; код `keep` можно сохранить.
const dropControls = (source, keep = -1) => {
  // Чистая строка — частый случай: возвращается как есть, без пересборки.
  let clean = true;
  for (let at = 0; clean && at < source.length; at += 1) {
    const unit = source.charCodeAt(at);
    clean = unit === keep || !(unit < 32 || unit === 127);
  }
  if (clean) return source;
  let kept = "";
  for (const ch of source) {
    const code = ch.charCodeAt(0);
    if (code === keep || !(code < 32 || code === 127)) kept += ch;
  }
  return kept;
};

// Первые `count` строк текста вместе с переводами между ними.
const leadingLines = (source, count) => {
  let end = -1;
  for (let n = 0; n < count; n += 1) {
    end = source.indexOf("\n", end + 1);
    if (end < 0) return source;
  }
  return source.slice(0, end);
};

const isHexRun = (digits) => [...digits].every((digit) => HEX_DIGITS.includes(digit));

// Общая часть multiline и markerName: свои границы по строкам и по длине.
const lineText = (value, fallback, maxLines, maxLength) => {
  const flat = textOf(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const kept = leadingLines(dropControls(flat, LINE_FEED), maxLines);
  return kept.trim() === "" ? fallback : kept.slice(0, maxLength);
};

export const number = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

export const clamp = (value, min, max, fallback) =>
  Math.min(max, Math.max(min, number(value, fallback)));

export const color = (value, fallback) => {
  const lowered = (value ? String(value) : "").trim().toLowerCase();
  const digits = lowered.slice(1);
  if (lowered[0] !== "#" || (digits.length !== 3 && digits.length !== 6) || !isHexRun(digits)) {
    return fallback;
  }
  return digits.length === 6 ? lowered : `#${[...digits].map((digit) => digit + digit).join("")}`;
};

export const flag = (value, fallback) => (typeof value === "boolean" ? value : Boolean(fallback));

export const text = (value, fallback, limit) => {
  const cleaned = dropControls(textOf(value));
  return cleaned.trim() === "" ? fallback : cleaned.slice(0, limit);
};

export const multiline = (value, fallback) =>
  lineText(value, fallback, WORLD_MAP_LIMITS.emblemLines, WORLD_MAP_LIMITS.emblemText);

export const markerName = (value, fallback) =>
  lineText(value, fallback, MARKER_NAME_LINES, WORLD_MAP_LIMITS.nameLength);

export const worldSize = (value, min, max) => {
  if (value == null || value === "") return null;
  const metres = Number(value);
  if (!Number.isFinite(metres)) return null;
  return Math.round(clamp(metres, min, max, min) * 10) / 10;
};

export const decimal = (value, min, max, fallback) =>
  Math.round(clamp(value, min, max, fallback) * 10) / 10;

export const choice = (value, options, fallback) => (options.includes(value) ? value : fallback);

const nextSerial = (() => {
  let issued = 0;
  return () => (issued += 1);
})();

export const mapObjectId = (prefix = "item") => {
  const serial = nextSerial();
  return `${prefix}-${Date.now().toString(36)}-${serial.toString(36)}`;
};
