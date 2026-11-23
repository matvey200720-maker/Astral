// Знаки, которые по месту клавиши (event.code) не зависят от раскладки.
const PLACE_SIGNS = new Map([
  ["BracketLeft", "["],
  ["BracketRight", "]"],
  ["Slash", "/"],
  ["Backslash", "\\"],
  ["Backquote", "`"],
  ["Minus", "-"],
  ["Equal", "="],
  ["Comma", ","],
  ["Period", "."],
  ["Semicolon", ";"],
  ["Quote", "'"],
]);

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "password",
  "number",
  "tel",
]);

const asText = (value) => (value ? String(value) : "");

// Один знак от «!» до «~»: латиница, цифры, знаки препинания.
function isAsciiSign(key) {
  if (key.length !== 1) return false;
  const point = key.charCodeAt(0);
  return point >= 33 && point <= 126;
}

// KeyZ → z, Digit5 → 5, BracketLeft → [; всё остальное — пустая строка.
function signOfPlace(code) {
  if (code.length === 4 && code.startsWith("Key")) {
    const letter = code[3];
    if (letter >= "A" && letter <= "Z") return letter.toLowerCase();
  }
  if (code.length === 6 && code.startsWith("Digit")) {
    const digit = code[5];
    if (digit >= "0" && digit <= "9") return digit;
  }
  return PLACE_SIGNS.get(code) ?? "";
}

export function hotkey(event) {
  const key = asText(event?.key);
  if (isAsciiSign(key)) return key.toLowerCase();
  return signOfPlace(asText(event?.code)) || key.toLowerCase();
}

export function historyKey(event) {
  if (!event || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const name = hotkey(event);
  if (name === "y") return "redo";
  if (name === "z") return event.shiftKey ? "redo" : "undo";
  return null;
}

export function isTextEntry(target) {
  const tag = target?.tagName;
  const isField =
    tag === "INPUT" ? TEXT_INPUT_TYPES.has(target.type) : tag === "TEXTAREA";
  return isField || Boolean(target?.isContentEditable);
}
