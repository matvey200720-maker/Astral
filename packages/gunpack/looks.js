// Чем заменён каждый ствол: разбор строк поста «ствол, разделитель, название».
import { WEAPONS } from "@modovik/rpf-inspector/weapon-identity";
import { slangFor } from "./slang.js";

export const LOOK_INPUT_LIMIT = 60;

const LOOK_NAME_LIMIT = 40;
const LEFT_WORDS_LIMIT = 6;

const LINE_BULLETS = /^[\s>•·*\-–—]+/;
const LINE_NUMBER = /^\d{1,2}[.)]\s*/;
const LINE_MARKUP = /[*_`~]/g;
const SEPARATOR = /→|->|=>|⇒|➜|➡️?|—|–|\s-\s|:|=/;

const DISCORD_EMOJI = /<a?:[A-Za-z0-9_]+:\d+>/g;
const PICTOGRAPHS = /[\p{Extended_Pictographic}️]/gu;
const NAME_MARKUP = /[*_`~|>]/g;
const NAME_TAIL = /[\s.,;!]+$/;
const FORBIDDEN_NAME = /https?:|www\.|discord/i;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

const MARK_TWO = /(?<![a-zа-я0-9])(?:mk|мк)\s*(?:ii|2)(?![a-zа-я0-9])/g;

// Запись для сравнения левой части и терминов.
function comparable(text) {
  return String(text)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim()
    .replace(MARK_TWO, "mk2");
}

const withoutSpaces = (text) => text.replaceAll(" ", "");

function termsOfWeapon({ id, name, catalog }) {
  const idWords = String(id).replace(/^WEAPON_/, "").replaceAll("_", " ");
  return [name, catalog, idWords, ...slangFor(id)].map(comparable).filter(Boolean);
}

const TERMS = WEAPONS.flatMap((weapon) =>
  termsOfWeapon(weapon).map((words) => ({
    weapon,
    words,
    compact: withoutSpaces(words),
  })),
);

// Победитель выбирается по всей таблице: чужой длинный термин закрывает короткий свой.
function weaponOfLeftPart(text) {
  const left = comparable(text);
  if (!left || left.split(" ").length > LEFT_WORDS_LIMIT) return null;
  const leftCompact = withoutSpaces(left);
  const framed = ` ${left} `;
  let longest = 0;
  let winners = new Set();
  for (const term of TERMS) {
    if (term.compact !== leftCompact && !framed.includes(` ${term.words} `)) continue;
    if (term.compact.length > longest) {
      longest = term.compact.length;
      winners = new Set();
    }
    if (term.compact.length === longest) winners.add(term.weapon.id);
  }
  if (winners.size !== 1) return null;
  const [id] = winners;
  return TERMS.find((term) => term.weapon.id === id).weapon;
}

function lookName(raw) {
  const name = raw
    .replace(DISCORD_EMOJI, "")
    .replace(PICTOGRAPHS, "")
    .replace(NAME_MARKUP, "")
    .replace(/\s+/g, " ")
    .replace(NAME_TAIL, "")
    .trim();
  if (!name || name.length > LOOK_NAME_LIMIT) return "";
  if (FORBIDDEN_NAME.test(name) || !HAS_LETTER_OR_DIGIT.test(name)) return "";
  return name;
}

function splitLine(rawLine) {
  const line = rawLine.replace(LINE_BULLETS, "").replace(LINE_NUMBER, "").replace(LINE_MARKUP, "");
  const separator = line.match(SEPARATOR);
  if (!separator || separator.index === 0) return null;
  return {
    left: line.slice(0, separator.index).trim(),
    right: line.slice(separator.index + separator[0].length).trim(),
  };
}

export function lookInput(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return text
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LOOK_INPUT_LIMIT);
}

export function looksFromPost(text, weapons = []) {
  if (!Array.isArray(weapons)) throw new TypeError("Стволы пака — не массив.");
  // Запись без непустой строки-модели в выборе не участвует.
  const packModels = new Set(
    weapons
      .map((entry) => (typeof entry === "string" ? entry : entry?.model))
      .filter((model) => model && typeof model === "string"),
  );
  const looks = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const parts = splitLine(rawLine);
    if (!parts) continue;
    const model = weaponOfLeftPart(parts.left)?.model;
    if (!packModels.has(model) || Object.hasOwn(looks, model)) continue;
    const name = lookName(parts.right);
    if (name) looks[model] = name;
  }
  return looks;
}
