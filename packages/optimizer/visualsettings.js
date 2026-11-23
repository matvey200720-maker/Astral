// visualsettings.dat — текстовая таблица «ключ значение». Правка меняет ровно
// те строки, чьё значение назначено заново; остальное возвращается как было.
// Для этого документ хранит исходные строки и номер строки каждого ключа.

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LINES = 20000;
const MAX_KEY_LENGTH = 128;
const MAX_DECIMALS = 6;

// Одиночный \r и разделители абзацев внутри строки данных не допускаются.
const FORBIDDEN_IN_LINE = new RegExp(`[\\r${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`);
// «Дословная» запись числа: 7, 7., 7.5, .5, с необязательным минусом и суффиксом f
// (так числа пишут в файлах игры и чужие графические моды; игра читает их как обычные).
const VERBATIM_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)[fF]?$/;

const isLetter = (code) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isKeyChar = (code) => isLetter(code) || (code >= 48 && code <= 57) || code === 46 || code === 95;
const isBlank = (char) => char.trim() === "";
const isGap = (char) => char === " " || char === "\t";

// Длина в байтах UTF-8, посчитанная по знакам UTF-16 (одинаково в Node.js и в окне):
// пара суррогатов — 4 байта, одиночный суррогат пишется знаком замены — 3 байта.
function utf8Bytes(text) {
  let total = 0;
  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at);
    if (unit < 0x80) {
      total += 1;
    } else if (unit < 0x800) {
      total += 2;
    } else if (unit >= 0xd800 && unit < 0xdc00 && text.charCodeAt(at + 1) >= 0xdc00 && text.charCodeAt(at + 1) < 0xe000) {
      total += 4;
      at += 1;
    } else {
      total += 3;
    }
  }
  return total;
}

// Байт не меньше, чем знаков: длинный текст отсекается сразу, а мерить имеет смысл
// только то, что может оказаться на границе (знак занимает не больше трёх байт).
const exceedsBytes = (text, limit) => text.length > limit || (text.length * 3 > limit && utf8Bytes(text) > limit);

// Строки текста без переводов: делит и \r\n, и \n; одиночный \r строку не делит.
function* eachLine(text) {
  let from = 0;
  for (;;) {
    const stop = text.indexOf("\n", from);
    if (stop < 0) {
      yield text.slice(from);
      return;
    }
    yield text.slice(from, stop > from && text[stop - 1] === "\r" ? stop - 1 : stop);
    from = stop + 1;
  }
}

// Длина ключа в начале текста (0 — ключа нет); считается до конца допустимых знаков.
function keyLengthAt(text) {
  if (!isLetter(text.charCodeAt(0))) return 0;
  let end = 1;
  while (end < text.length && isKeyChar(text.charCodeAt(end))) end += 1;
  return end;
}

function isValidKey(name) {
  const length = keyLengthAt(name);
  return length > 0 && length === name.length && length <= MAX_KEY_LENGTH;
}

// Разбор строки данных: ключ у самого края, разделитель из пробелов и табуляций,
// значение с первого непробельного знака до конца без хвостовых пробелов/табуляций.
function scanDataLine(line) {
  if (typeof line !== "string") return null;
  const keyEnd = keyLengthAt(line);
  if (keyEnd === 0 || keyEnd > MAX_KEY_LENGTH) return null;

  let valueStart = keyEnd;
  while (isGap(line[valueStart] ?? "")) valueStart += 1;
  if (valueStart === keyEnd || valueStart === line.length || isBlank(line[valueStart])) return null;
  if (FORBIDDEN_IN_LINE.test(line)) return null;

  let valueEnd = line.length;
  while (isGap(line[valueEnd - 1])) valueEnd -= 1;
  return { key: line.slice(0, keyEnd), valueStart, valueEnd };
}

export function parseVisualSettings(input) {
  const text = input == null ? "" : String(input);
  if (text.trim() === "") throw new Error("Файл visualsettings.dat пуст.");
  if (exceedsBytes(text, MAX_BYTES)) throw new Error("Файл visualsettings.dat превышает безопасный размер.");

  const lines = [];
  for (const line of eachLine(text)) {
    if (lines.push(line) > MAX_LINES) throw new Error("Файл visualsettings.dat содержит слишком много строк.");
  }

  // Повтор ключа: побеждает последняя строка, порядок ключей — по первому появлению.
  const keys = new Map(
    lines.flatMap((line, index) => {
      const hit = scanDataLine(line);
      return hit === null ? [] : [[hit.key, index]];
    }),
  );
  if (keys.size === 0) throw new Error("В visualsettings.dat не найдено ни одного параметра.");

  return { newline: text.indexOf("\r\n") >= 0 ? "\r\n" : "\n", lines, keys };
}

export function readVisualSetting(document, key) {
  const keys = document?.keys;
  if (keys == null) return null;
  const index = keys.get(key);
  if (index === undefined) return null;
  const line = document.lines[index];
  const hit = scanDataLine(line);
  return hit === null ? null : line.slice(hit.valueStart, hit.valueEnd);
}

// Число по образцу — текущему значению строки. Без точки в образце — целое,
// с точкой — столько же знаков после неё (все знаки образца, но не больше шести).
// Суффикс f числа-образца сохраняется и знаком после точки не считается: раньше
// «750.0f» превращалось в «520.00», и возврат к штатному «750.0f» падал.
function renderLike(sample, number) {
  const trimmed = sample.trim();
  const suffix = VERBATIM_NUMBER.test(trimmed) && /[fF]$/.test(trimmed) ? trimmed.slice(-1) : "";
  const [, ...afterDot] = trimmed.slice(0, trimmed.length - suffix.length).split(".");
  if (afterDot.length === 0) return `${Math.round(number)}${suffix}`;
  return number.toFixed(Math.min(MAX_DECIMALS, afterDot.join(".").length)) + suffix;
}

// Значение правки: либо готовая запись (`text`), либо число, которое ещё надо оформить.
function interpretValue(key, raw) {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (VERBATIM_NUMBER.test(trimmed)) return { text: trimmed };
  }
  const number = Number(raw);
  if (!Number.isFinite(number)) throw new Error(`Нечисловое значение для «${key}».`);
  return { number };
}

// Решение по одному ключу правки. Применённую правку сразу вносит в копию строк.
function decide(document, lines, key, raw) {
  if (!isValidKey(key)) throw new Error(`Недопустимый ключ «${key}».`);
  const wish = interpretValue(key, raw);

  const index = document.keys.get(key);
  const hit = scanDataLine(lines[index]);
  if (hit === null) return { key, status: "missing" };

  const line = lines[index];
  const from = line.slice(hit.valueStart, hit.valueEnd);
  const to = wish.text ?? renderLike(from, wish.number);
  if (to === from) return { key, status: "unchanged" };

  lines[index] = line.slice(0, hit.valueStart) + to + line.slice(hit.valueEnd);
  return { key, status: "applied", from, to };
}

export function patchVisualSettings(document, values) {
  // Первым делом: поле строк должно перебираться (иначе TypeError до разбора правок).
  const lines = [...document.lines];
  const outcomes = (values == null ? [] : Object.entries(values)).map(([key, raw]) => decide(document, lines, key, raw));
  const withStatus = (status) => outcomes.filter((outcome) => outcome.status === status);

  return {
    // Остальные поля документа (и их порядок) сохраняются, меняются только строки.
    document: { ...document, lines },
    applied: withStatus("applied").map(({ key, from, to }) => ({ key, from, to })),
    missing: withStatus("missing").map(({ key }) => key),
    unchanged: withStatus("unchanged").map(({ key }) => key),
  };
}

export function serializeVisualSettings(document) {
  if (!Array.isArray(document.lines)) throw new TypeError("У документа нет списка строк");
  return document.lines.join(document.newline);
}
