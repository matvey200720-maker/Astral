/*
 * Числа и фразы экрана «Выборочные» (каталог 2.0): склонение «скин» и «пак» по правилам языка окна.
 * `Intl.PluralRules` даёт категорию числа (one/few/many/other), таблица ниже — слово для неё. Остальные подписи экрана — в словаре
 * (`locales/ui-text/zone-catalog2-menu.js`), здесь только то, что зависит от числа.
 */

const SKIN = {
  ru: { one: "скин", few: "скина", many: "скинов", other: "скина" },
  uk: { one: "скін", few: "скіни", many: "скінів", other: "скіна" },
  en: { one: "skin", other: "skins" },
  de: { one: "Skin", other: "Skins" },
  pl: { one: "skin", few: "skiny", many: "skinów", other: "skina" },
  fr: { one: "skin", other: "skins" },
};

/* После «из» слово «пак» стоит в родительном падеже: «из 1 пака», «из 24 паков». */
const PACK_AFTER_OF = {
  ru: { one: "пака", few: "паков", many: "паков", other: "паков" },
  uk: { one: "паку", few: "паків", many: "паків", other: "паків" },
  en: { one: "pack", other: "packs" },
  de: { one: "Pack", other: "Packs" },
  pl: { one: "paczki", few: "paczek", many: "paczek", other: "paczek" },
  fr: { one: "pack", other: "packs" },
};

const FROM = {
  ru: "из",
  uk: "з",
  en: "from",
  de: "aus",
  pl: "z",
  fr: "issus de",
};
const ONLY_THIS_WEAPON = {
  ru: "ставится только этот ствол",
  uk: "ставиться лише цей ствол",
  en: "installs this weapon only",
  de: "installiert nur diese Waffe",
  pl: "instaluje tylko tę broń",
  fr: "n’installe que cette arme",
};

const rules = new Map();
function categoryOf(language, count) {
  const code = SKIN[language] ? language : "en";
  if (!rules.has(code)) rules.set(code, new Intl.PluralRules(code));
  const category = rules.get(code).select(count);
  return { code, category };
}

const pick = (table, language, count) => {
  const { code, category } = categoryOf(language, count);
  return table[code][category] ?? table[code].other;
};

const grouped = (count, language) =>
  count.toLocaleString(language === "uk" ? "uk-UA" : language);

/** «31 скин», «44 скина», «495 скинов» — подпись под названием ствола. */
export const skinsLabel = (count, language = "ru") =>
  `${grouped(count, language)} ${pick(SKIN, language, count)}`;

/** «31 скин из 24 паков · ставится только этот ствол» — строка под названием на экране ствола. */
export function skinsFromPacksLine(skins, packs, language = "ru") {
  const code = SKIN[language] ? language : "en";
  /* Скин, которого нет ни в одном ганпаке, — без «из 0 паков»: говорим только, что ставится один ствол. */
  const from =
    packs > 0
      ? ` ${FROM[code]} ${grouped(packs, language)} ${pick(PACK_AFTER_OF, language, packs)}`
      : "";
  return `${skinsLabel(skins, code)}${from} · ${ONLY_THIS_WEAPON[code]}`;
}

const WEAPON = {
  ru: { one: "ствол", few: "ствола", many: "стволов", other: "ствола" },
  uk: { one: "ствол", few: "стволи", many: "стволів", other: "стволи" },
  en: { one: "weapon", other: "weapons" },
  de: { one: "Waffe", other: "Waffen" },
  pl: { one: "broń", few: "bronie", many: "broni", other: "broni" },
  fr: { one: "arme", other: "armes" },
};

/** «18 стволов» — подпись плитки ганпака в сетке каталога (сколько стволов в паке). */
export const weaponsLabel = (count, language = "ru") =>
  `${grouped(count, language)} ${pick(WEAPON, language, count)}`;
