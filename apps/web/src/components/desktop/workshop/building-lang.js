// Название вкладки «Колонки» (топливные колонки) в просмотре заправки.

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];
// Слова идут в том же порядке, что и языки.
const WORDS = [
  "Колонки",
  "Колонки",
  "Pumps",
  "Zapfsäulen",
  "Dystrybutory",
  "Pompes",
];

const WORD_BY_LANGUAGE = Object.fromEntries(
  LANGUAGES.map((language, i) => [language, WORDS[i]]),
);

// Запасной язык — русский. Поиск прямо по объекту: имя встроенного свойства
// вместо языка вернёт само это свойство, как в эталоне.
export function pumpsViewLabel(language) {
  const word = WORD_BY_LANGUAGE[language];
  return word || WORD_BY_LANGUAGE.ru;
}
