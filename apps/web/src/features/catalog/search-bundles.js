// Три правила выдачи для сборок и паков: части найденной сборки из выдачи прячутся,
// названия, начинающиеся с запроса, идут раньше, у каждой части известна сборка-владелец.

const MIN_NAME_LETTERS = 3;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

// Состав проверяется только по длине: «abc» и { length: 2 } тоже считаются составом.
const hasParts = (mod) => Boolean(mod?.includedModIds?.length);

export const modsWithParts = (mods = []) => mods.filter(hasParts);

// Прячет состав одной сборки в общий набор; саму сборку не прячет, а записанное не проверяет.
function foldInto(hidden, group) {
  for (const id of group.includedModIds) {
    if (id === group.id) continue;
    hidden.add(id);
  }
}

export const partsFoldedBy = (groups, matches) => {
  const folded = new Set();
  for (const group of groups) {
    if (matches(group)) foldInto(folded, group);
  }
  return folded;
};

// Ступень названия: 0 — все слова есть и оно начинается с первого слова; 1 — все слова есть,
// но не с начала; 2 — нашлось только по тегам.
function tierOf(name, words) {
  for (const word of words) {
    if (!name.includes(word)) return 2;
  }
  return name.startsWith(words[0]) ? 0 : 1;
}

export const rankByName = (list, query, nameOf) => {
  if (!query) return list;
  if (list.length < 2) return list;
  // Слова не складываются: запрос и названия приходят уже сложенными.
  const tiers = Array.from({ length: 3 }, () => []);
  const words = query.split(" ");
  for (const item of list) tiers[tierOf(nameOf(item), words)].push(item);
  return tiers.flat();
};

// Имя для сравнения: только буквы и цифры любых алфавитов, регистр по языку среды.
const squash = (value) => (String(value || "").toLocaleLowerCase().match(LETTER_OR_DIGIT) ?? []).join("");

// Сборка «называет» часть, если её очищенное имя (не короче трёх знаков) входит в очищенные
// имя или id этой части. Части нет в списке — не называет никого.
function claims(bundle, part) {
  if (!part) return false;
  const label = squash(bundle.name);
  return label.length >= MIN_NAME_LETTERS && (squash(part.name).includes(label) || squash(part.id).includes(label));
}

// Часть, которую уже держит другая сборка, переходит к этой, только если её имя встречается в
// части, а имя прежнего владельца — нет.
const winnerOf = (holder, bundle, part) => (!claims(holder, part) && claims(bundle, part) ? bundle : holder);

function takePart(owners, partById, bundle, partId) {
  const holder = owners.get(partId);
  owners.set(partId, holder ? winnerOf(holder, bundle, partById.get(partId)) : bundle);
}

const idEntry = (mod) => [mod?.id, mod];

export const reduxOfParts = (mods = []) => {
  const bundles = modsWithParts(mods).filter((mod) => mod.publicationMode === "bundle");

  // Справочник «id → мод»: при одинаковых id остаётся последний мод, мод без id лежит под
  // ключом undefined. map() сохраняет дыры разреженного списка, и конструктор Map на дыре
  // бросает TypeError — так и должно быть.
  const partById = new Map(mods.map(idEntry));

  const owners = new Map();
  for (const bundle of bundles) {
    for (const partId of bundle.includedModIds) {
      if (partId !== bundle.id) takePart(owners, partById, bundle, partId);
    }
  }
  return owners;
};
