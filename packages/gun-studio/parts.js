// Роль детали оружейной модели по имени материала, имя текстуры цвета для
// покраски и файлы текстур ствола в игре.

export const BODY_ROLES = Object.freeze(new Set(["body", "barrel", "grip", "stock", "camo"]));

// Что может стоять после основы окончания до самого конца имени.
const NOTHING = "nothing";
const DIGITS = "digits";
const WORD = "word";

// Окончания проверяются по порядку, первое подошедшее решает роль.
// boundary — перед основой начало имени или «_».
const ENDINGS = [
  { stems: ["flash", "flashsupp"], after: NOTHING, boundary: false, role: "suppressor" },
  { stems: ["supp", "suppressor"], after: NOTHING, boundary: false, role: "suppressor" },
  { stems: ["mag", "magazine"], after: DIGITS, boundary: true, role: "mag" },
  { stems: ["clip"], after: DIGITS, boundary: true, role: "mag" },
  { stems: ["drum"], after: NOTHING, boundary: true, role: "mag" },
  { stems: ["scope"], after: WORD, boundary: true, role: "scope" },
  { stems: ["sight"], after: WORD, boundary: true, role: "scope" },
  { stems: ["grip"], after: NOTHING, boundary: true, role: "grip" },
  { stems: ["stock"], after: NOTHING, boundary: true, role: "stock" },
  { stems: ["barrel"], after: NOTHING, boundary: true, role: "barrel" },
  { stems: ["camo"], after: DIGITS, boundary: true, role: "camo" },
  { stems: ["lux", "luxe"], after: DIGITS, boundary: true, role: "body" },
  { stems: ["skin"], after: DIGITS, boundary: true, role: "body" },
];

const isAsciiLower = (ch) => ch >= "a" && ch <= "z";
const isAsciiLetter = (ch) => isAsciiLower(ch) || (ch >= "A" && ch <= "Z");
const isDigit = (ch) => ch >= "0" && ch <= "9";
const isWordChar = (ch) => isAsciiLower(ch) || isDigit(ch) || ch === "_";

const tailFits = {
  [NOTHING]: (rest) => rest === "",
  [DIGITS]: (rest) => [...rest].every(isDigit),
  [WORD]: (rest) => [...rest].every(isWordChar),
};

function cleanName(value) {
  return (value ? String(value) : "").trim();
}

// Только латиница меняет регистр — как у сравнения без учёта регистра в шаблонах.
function asciiLower(text) {
  let out = "";
  for (const ch of text) out += ch >= "A" && ch <= "Z" ? ch.toLowerCase() : ch;
  return out;
}

function endingFits(name, { stems, after, boundary }) {
  for (const stem of stems) {
    for (let at = name.indexOf(stem); at !== -1; at = name.indexOf(stem, at + 1)) {
      if (boundary && at > 0 && name[at - 1] !== "_") continue;
      if (tailFits[after](name.slice(at + stem.length))) return true;
    }
  }
  return false;
}

export function materialRole(name) {
  const lowered = asciiLower(cleanName(name));
  if (!lowered) return "body";
  if (lowered.includes("decal")) return "decal";
  return ENDINGS.find((ending) => endingFits(lowered, ending))?.role ?? "body";
}

// «W_» + две латинские буквы + «_», регистр любой.
function isTexturePrefix(text, at) {
  return (
    (text[at] === "W" || text[at] === "w") &&
    text[at + 1] === "_" &&
    isAsciiLetter(text[at + 2] ?? "") &&
    isAsciiLetter(text[at + 3] ?? "") &&
    text[at + 4] === "_"
  );
}

const PREFIX_LENGTH = 5;

export function colourTextureName(materialName) {
  const name = cleanName(materialName);
  let seen = 0;
  for (let at = 0; at < name.length; ) {
    if (!isTexturePrefix(name, at)) {
      at += 1;
      continue;
    }
    seen += 1;
    // Склеенное имя наклейки: цвет + маска; цвет — до второй приставки.
    if (seen === 2) return name.slice(0, at);
    at += PREFIX_LENGTH;
  }
  return name;
}

function isWeaponModelName(base) {
  if (!base.startsWith("w_") || base[4] !== "_") return false;
  if (!isAsciiLower(base[2] ?? "") || !isAsciiLower(base[3] ?? "")) return false;
  const rest = base.slice(PREFIX_LENGTH);
  return rest.length > 0 && [...rest].every(isWordChar);
}

export function weaponTextureFiles(model) {
  let base = cleanName(model).toLowerCase();
  if (base.endsWith(".ytd") || base.endsWith(".ydr")) base = base.slice(0, -4);
  return isWeaponModelName(base) ? [`${base}.ytd`, `${base}+hi.ytd`] : [];
}
