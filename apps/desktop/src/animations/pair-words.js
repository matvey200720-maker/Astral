/*
 * Парные анимации (двое персонажей) по имени словаря и клипа — слова по границам частей имени, а не подстроки (14.11.2026, ревью): «Blow Kiss» (воздушный поцелуй соло),
 * «thug», «huge», «clover» парными не считаются. Те же правила — в окне для анимаций игры (`apps/web/.../animation-library.js: isPairedEntry`); тест на общем списке — `tests/animation-pair-words.test.js`.
 */

/* Слова-приставки: целое слово (`hug`, `pairs`) или начало слова, где это безопасно (`kissfemale8`, `couple1`, `cplx`). */
const EXACT = new Set([
  "couple",
  "couples",
  "cpl",
  "pair",
  "pairs",
  "hug",
  "hugs",
  "hugging",
  "handshake",
  "handshakes",
  "highfive",
  "embrace",
  "propose",
  "proposal",
]);
const PREFIX = /^(kiss|couple|cpl|handshake|highfive|embrace)/;

/** Слова имени: латинские буквы подряд, цифры и знаки — границы (`cpl2` → `cpl`, `kissfemale8` → `kissfemale`). */
export const nameWords = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/** Парная ли анимация по словам имени словаря и клипа. */
export function isPairedName(dictionary, clip = "") {
  const words = nameWords(`${dictionary} ${clip}`);
  return words.some((word, at) => {
    /* Воздушный поцелуй — жест одного персонажа. */
    if (word === "kiss" && words[at - 1] === "blow") return false;
    if (word === "blow" || word === "blown") return false;
    if (word === "high" && words[at + 1] === "five") return true;
    return EXACT.has(word) || PREFIX.test(word);
  });
}
