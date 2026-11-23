/*
 * Слова строки «Вернуть моды» в «Настройки → Игра → GTA V» (владелец, 16.11.2026): тихая, пока всё на месте, и подсвеченная, когда моды пропали после проверки файлов игры.
 * Таблицы по языкам прямо здесь: число модов склоняется (`Intl.PluralRules` языка), а на русский склонение не переводится словарём.
 */

const forms = {
  ru: { one: "мод", few: "мода", many: "модов", other: "мода" },
  uk: { one: "мод", few: "моди", many: "модів", other: "моди" },
  en: { one: "mod", other: "mods" },
  de: { one: "Mod", other: "Mods" },
  pl: { one: "mod", few: "mody", many: "modów", other: "mody" },
  fr: { one: "mod", other: "mods" },
};

const WORDS = {
  ru: {
    title: "Моды пропали из игры",
    note: (count, noun) =>
      `Похоже, была проверка файлов. Вернуть ${count} ${noun}`,
    action: "Вернуть",
    working: "Возвращаю…",
    quietTitle: "Вернуть моды",
    quietNote:
      "Если игра сбросила моды после проверки файлов, вернём их отсюда",
    inPlace: "Всё на месте",
    nav: "Моды пропали",
  },
  uk: {
    title: "Моди зникли з гри",
    note: (count, noun) =>
      `Схоже, була перевірка файлів. Повернути ${count} ${noun}`,
    action: "Повернути",
    working: "Повертаю…",
    quietTitle: "Повернути моди",
    quietNote:
      "Якщо гра скинула моди після перевірки файлів, повернемо їх звідси",
    inPlace: "Усе на місці",
    nav: "Моди зникли",
  },
  en: {
    title: "Mods vanished from the game",
    note: (count, noun) =>
      `Looks like the files were verified. Restore ${count} ${noun}`,
    action: "Restore",
    working: "Restoring…",
    quietTitle: "Restore mods",
    quietNote:
      "If the game wiped your mods after a file check, bring them back from here",
    inPlace: "All in place",
    nav: "Mods gone",
  },
  de: {
    title: "Mods sind aus dem Spiel verschwunden",
    note: (count, noun) =>
      `Vermutlich wurden die Dateien überprüft. ${count} ${noun} wiederherstellen`,
    action: "Wiederherstellen",
    working: "Stelle wieder her …",
    quietTitle: "Mods wiederherstellen",
    quietNote:
      "Wenn das Spiel die Mods nach einer Dateiprüfung entfernt hat, bekommst du sie hier zurück",
    inPlace: "Alles da",
    nav: "Mods fehlen",
  },
  pl: {
    title: "Mody zniknęły z gry",
    note: (count, noun) =>
      `Wygląda na to, że pliki zostały zweryfikowane. Przywróć ${count} ${noun}`,
    action: "Przywróć",
    working: "Przywracam…",
    quietTitle: "Przywróć mody",
    quietNote:
      "Jeśli gra usunęła mody po sprawdzeniu plików, przywrócisz je stąd",
    inPlace: "Wszystko na miejscu",
    nav: "Mody zniknęły",
  },
  fr: {
    title: "Les mods ont disparu du jeu",
    note: (count, noun) =>
      `Une vérification des fichiers a probablement eu lieu. Restaurer ${count} ${noun}`,
    action: "Restaurer",
    working: "Restauration…",
    quietTitle: "Restaurer les mods",
    quietNote:
      "Si le jeu a supprimé vos mods après une vérification des fichiers, restaurez-les ici",
    inPlace: "Tout est en place",
    nav: "Mods disparus",
  },
};

const rules = new Map();
function noun(language, count) {
  if (!rules.has(language)) rules.set(language, new Intl.PluralRules(language));
  const table = forms[language] || forms.en;
  return table[rules.get(language).select(count)] || table.other;
}

/** Слова строки на языке окна; `note(count)` склоняет «мод» по числу. Нет такого языка — английский. */
export function restoreModsCopy(language) {
  const words = WORDS[language] || WORDS.en;
  const code = WORDS[language] ? language : "en";
  return { ...words, note: (count) => words.note(count, noun(code, count)) };
}
