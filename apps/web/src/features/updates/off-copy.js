// Слова для сборки без службы обновлений: заголовок и одна строка под ним.
// Файл лежит в стартовом куске окна, поэтому ничего не импортирует.
// OFF_COPY[язык] = { heading, off }; offCopyFor(язык) отдаёт тот же объект, запасной язык — английский.

// Заголовок и строка под ним по языкам.
const HEADINGS = {
  ru: "Обновления",
  uk: "Оновлення",
  en: "Updates",
  de: "Updates",
  pl: "Aktualizacje",
  fr: "Mises à jour",
};

const NOTES = {
  ru: "Автообновления пока нет: новую версию ставит установщик Astral.",
  uk: "Автооновлення поки немає: нову версію встановлює інсталятор Astral.",
  en: "There are no automatic updates yet: new versions come with the Astral installer.",
  de: "Automatische Updates gibt es noch nicht: neue Versionen bringt das Astral-Installationsprogramm.",
  pl: "Automatycznych aktualizacji jeszcze nie ma: nową wersję instaluje instalator Astral.",
  fr: "Pas encore de mises à jour automatiques\u00a0: les nouvelles versions viennent avec l’installateur Astral.",
};

// Обычный литерал из чистых выражений: пока слова никто не читает, сборка выкидывает их из стартового куска.
export const OFF_COPY = {
  ru: { heading: HEADINGS.ru, off: NOTES.ru },
  uk: { heading: HEADINGS.uk, off: NOTES.uk },
  en: { heading: HEADINGS.en, off: NOTES.en },
  de: { heading: HEADINGS.de, off: NOTES.de },
  pl: { heading: HEADINGS.pl, off: NOTES.pl },
  fr: { heading: HEADINGS.fr, off: NOTES.fr },
};

export function offCopyFor(language) {
  return typeof language === "string" &&
    Object.prototype.hasOwnProperty.call(OFF_COPY, language)
    ? OFF_COPY[language]
    : OFF_COPY.en;
}
