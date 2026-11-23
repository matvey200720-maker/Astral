// Код беты: приставка BETA- и 16 знаков Crockford base32 группами по четыре.
// Правила разбора совпадают с хостом (BRIDGE.md §3, internal/install/code.go):
// верхний регистр, O -> 0, I и L -> 1, всё вне алфавита (в том числе U) — ошибка.

export const CODE_PREFIX = "BETA";
export const CODE_BODY_LENGTH = 16;
export const GROUP_SIZE = 4;
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Нарезка идёт по `length` и `slice`, поэтому годится всё, что их имеет.
export function formatCodeBody(body) {
  const groups = Math.ceil(body.length / GROUP_SIZE);
  return Array.from({ length: groups }, (_, n) => body.slice(n * GROUP_SIZE, (n + 1) * GROUP_SIZE)).join("-");
}

export const fullCode = (body) => `${CODE_PREFIX}-${formatCodeBody(body)}`;

export const isCodeComplete = (body) => body.length === CODE_BODY_LENGTH;

// Курсор считается в знаках кода, а не в позициях строки: поле заново пишет
// свою строку с дефисами, и курсор не должен прыгать.
export function caretAfter(formatted, count) {
  if (count <= 0) return 0;

  const end = formatted.length;
  const codeSpots = [];
  for (let i = 0; i < end; i += 1) {
    if (formatted[i] !== "-") codeSpots.push(i);
  }
  const spot = Number.isInteger(count) ? codeSpots[count - 1] : undefined;
  return spot === undefined ? end : spot + 1;
}

const VALID = new Set(ALPHABET);
// Схожие знаки: позиция в первой строке — замена во второй.
const LOOKALIKES = ["OIL", "011"];

// Разделители внутри кода (выбрасываются без следа) и разделитель сразу после
// приставки: набор разный. Нулевая ширина и U+2060 после BETA приставку не
// закрывают, а U+2060 не пропускается и перед ней — так было с первого дня.
const NOISE = /[\s\-_.:\u2010-\u2015\u2212\u200b-\u200d\u2060]/g;
const LEADING_PREFIX = /^[\s\u200b-\u200d]*BETA[\s\-_.:\u2010-\u2015\u2212]/;

const fold = (ch) => {
  const at = LOOKALIKES[0].indexOf(ch);
  return at < 0 ? ch : LOOKALIKES[1][at];
};

// Строка без приставки и разделителей. Слитное «BETA…» считаем приставкой
// только когда знаков больше 16: иначе это мог быть сам код.
function stripPrefix(upper) {
  if (LEADING_PREFIX.test(upper)) return upper.replace(LEADING_PREFIX, "").replace(NOISE, "");
  const flat = upper.replace(NOISE, "");
  const tooLong = [...flat].length > CODE_BODY_LENGTH;
  return tooLong && flat.startsWith(CODE_PREFIX) ? flat.slice(CODE_PREFIX.length) : flat;
}

export function normalizeCodeInput(raw) {
  const symbols = [...stripPrefix(String(raw ?? "").toUpperCase())].map((original) => ({
    original,
    folded: fold(original),
  }));

  const accepted = symbols.filter((s) => VALID.has(s.folded));
  const rejected = symbols.filter((s) => !VALID.has(s.folded)).map((s) => s.original);

  return {
    body: accepted
      .slice(0, CODE_BODY_LENGTH)
      .map((s) => s.folded)
      .join(""),
    rejected: [...new Set(rejected)],
    truncated: accepted.length > CODE_BODY_LENGTH,
  };
}

export function validBefore(raw, caret) {
  const typed = String(raw ?? "");
  return normalizeCodeInput(typed.slice(0, caret)).body.length;
}
