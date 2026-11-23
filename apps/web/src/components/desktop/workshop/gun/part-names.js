import { tr } from "../../../../locales/ui.js";
import { ctx, fill, tl, trKey } from "./gun-copy.js";

// Зоны татуировок: имя целиком в нижнем регистре. Обычный объект: имена из
// прототипа (constructor, __proto__) находятся в нём тоже.
const TATTOO_ZONES = {
  tattoo_torso: trKey("Торс"),
  tattoo_head: trKey("Голова"),
  tattoo_arm_left: trKey("Левая рука"),
  tattoo_arm_right: trKey("Правая рука"),
  tattoo_leg_left: trKey("Левая нога"),
  tattoo_leg_right: trKey("Правая нога"),
};

const isDigit = (ch) => ch >= "0" && ch <= "9";
const isTail = (ch) => (ch >= "a" && ch <= "z") || isDigit(ch) || ch === "_";

function onlyTailFrom(name, from) {
  for (let i = from; i < name.length; i += 1) {
    if (!isTail(name[i])) return false;
  }
  return true;
}

// Имя оканчивается одним из слов (перед словом — начало имени или «_»,
// после — по желанию номер).
function endsWithWord(name, words, { digits = false, bounded = true } = {}) {
  let end = name.length;
  if (digits) {
    while (end > 0 && isDigit(name[end - 1])) end -= 1;
  }
  const stem = name.slice(0, end);
  return words.some((word) => {
    if (!stem.endsWith(word)) return false;
    const before = stem.length - word.length;
    return !bounded || before === 0 || stem[before - 1] === "_";
  });
}

// Слово стоит в начале имени или после «_», а за ним до конца идут только
// латинские буквы, цифры и «_».
function hasWordWithTail(name, word) {
  for (let at = name.indexOf(word); at !== -1; at = name.indexOf(word, at + 1)) {
    const opens = at === 0 || name[at - 1] === "_";
    if (opens && onlyTailFrom(name, at + word.length)) return true;
  }
  return false;
}

// Шейдер одежды персонажа: ped либо ped_ с непустым хвостом.
function isPedShader(name) {
  if (name === "ped") return true;
  return name.startsWith("ped_") && name.length > 4 && onlyTailFrom(name, 4);
}

// Номер наклейки: цифры после первого decal/decals (и одного «_») слева.
function decalNumber(name) {
  for (let at = name.indexOf("decal"); at !== -1; at = name.indexOf("decal", at + 1)) {
    let from = at + 5;
    if (name[from] === "s") from += 1;
    if (name[from] === "_") from += 1;
    let to = from;
    while (to < name.length && isDigit(name[to])) to += 1;
    if (to > from) return Number(name.slice(from, to));
  }
  return null;
}

// Роли по суффиксу, сверху вниз: побеждает первая подошедшая.
const ROLES = [
  { label: trKey("Пламегаситель"), test: (name) => endsWithWord(name, ["flash", "flashsupp"], { bounded: false }) },
  { label: trKey("Глушитель"), test: (name) => endsWithWord(name, ["supp", "suppressor"], { bounded: false }) },
  { label: ctx("magazine"), test: (name) => endsWithWord(name, ["mag", "magazine"]) },
  { label: ctx("magazine"), test: (name) => endsWithWord(name, ["clip"], { digits: true }) },
  { label: ctx("scope"), test: (name) => hasWordWithTail(name, "scope") },
  { label: ctx("scope"), test: (name) => hasWordWithTail(name, "sight") },
  { label: trKey("Рукоять"), test: (name) => endsWithWord(name, ["grip"]) },
  { label: trKey("Приклад"), test: (name) => endsWithWord(name, ["stock"]) },
  { label: ctx("barrel"), test: (name) => endsWithWord(name, ["barrel"]) },
  { label: trKey("Барабанный магазин"), test: (name) => endsWithWord(name, ["drum"]) },
  { label: trKey("Камуфляж"), test: (name) => endsWithWord(name, ["camo"], { digits: true }) },
  { label: trKey("Отделка"), test: (name) => endsWithWord(name, ["lux", "luxe"], { digits: true }) },
  { label: trKey("Скин"), test: (name) => endsWithWord(name, ["skin"], { digits: true }) },
  { label: trKey("Ткань"), test: isPedShader },
];

function titleOf(source) {
  if (!source) return tr("Деталь");
  const name = source.toLowerCase();

  const zone = TATTOO_ZONES[name];
  if (zone) return tr(zone);

  const sticker = decalNumber(name);
  if (sticker !== null) return fill(tr("Наклейки {n}"), { n: sticker });
  if (name.includes("decal")) return tr("Наклейки");

  const role = ROLES.find((entry) => entry.test(name));
  return role ? tl(role.label) : tr("Корпус");
}

export function gunPartName(textureName) {
  const source = String(textureName || "").trim();
  return { title: titleOf(source), source };
}
