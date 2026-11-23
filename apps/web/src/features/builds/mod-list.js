/*
 * Счёт и перечень модов на языке окна: «2 мода», «„A“, „B“ и ещё 3 мода».
 *
 * Нужны и странице «Сборки», и всплывашке оболочки об отказе сборки, поэтому
 * живут отдельно от слов страницы: оболочка не тянет в главный кусок весь
 * раздел ради двух функций.
 *
 * Счёт склоняется правилом языка (`Intl.PluralRules`), а не русской
 * арифметикой: у украинского и польского свои три формы, у немецкого,
 * английского и французского — две.
 */

const MOD_FORMS = {
  ru: { one: "мод", few: "мода", many: "модов", other: "мода" },
  uk: { one: "мод", few: "моди", many: "модів", other: "мода" },
  pl: { one: "mod", few: "mody", many: "modów", other: "moda" },
  de: { one: "Mod", other: "Mods" },
  en: { one: "mod", other: "mods" },
  fr: { one: "mod", other: "mods" },
};

const pluralRules = new Map();

export function modCount(language, count) {
  if (!pluralRules.has(language))
    pluralRules.set(language, new Intl.PluralRules(language));
  const forms = MOD_FORMS[language] || MOD_FORMS.en;
  const form = pluralRules.get(language).select(count);
  return `${count} ${forms[form] || forms.other}`;
}

/* «A, B и ещё 3 мода» — первые два имени и счёт остальных; мод без имени
   (его нет в каталоге) попадает в счёт. */
export function modList(language, mods, and, [open, close]) {
  const named = mods.filter((mod) => mod.name).slice(0, 2);
  const rest = mods.length - named.length;
  const names = named.map((mod) => `${open}${mod.name}${close}`).join(", ");
  if (!rest) return names;
  const tail = modCount(language, rest);
  return names ? `${names} ${and} ${tail}` : tail;
}
