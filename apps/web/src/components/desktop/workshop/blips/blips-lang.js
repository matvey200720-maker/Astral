// Помощники окна значков карты: подстановка значений в готовую фразу
// и подпись севера на радаре.

const NAME_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

// Индекс первого символа после имени метки, которое начинается с `from`.
function endOfName(source, from) {
  let end = from;
  while (end < source.length && NAME_CHARS.includes(source[end])) end += 1;
  return end;
}

// Подставляет поля `values` вместо меток {имя}. Текст разбирается один раз,
// слева направо, поэтому подставленное значение заново не читается. Поле
// ищется оператором in, то есть с учётом прототипа; на не-объекте он бросает
// TypeError, но только когда в тексте нашлась настоящая метка.
export function fill(text, values) {
  const source = String(text);
  const chunks = [];
  let copied = 0;
  let open = source.indexOf("{");
  while (open !== -1) {
    const nameStart = open + 1;
    const nameEnd = endOfName(source, nameStart);
    if (nameEnd > nameStart && source[nameEnd] === "}") {
      const name = source.slice(nameStart, nameEnd);
      chunks.push(
        source.slice(copied, open),
        name in values ? String(values[name]) : `{${name}}`,
      );
      copied = nameEnd + 1;
      open = source.indexOf("{", copied);
    } else {
      open = source.indexOf("{", nameStart);
    }
  }
  chunks.push(source.slice(copied));
  return chunks.join("");
}

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];
// Подписи идут в том же порядке, что и языки. Кириллическая «С» (U+0421),
// не латинская C.
const NORTH = ["С", "Пн", "N", "N", "N", "N"];

const NORTH_BY_LANGUAGE = Object.fromEntries(
  LANGUAGES.map((language, i) => [language, NORTH[i]]),
);

// Неизвестный язык даёт русскую подпись. Поиск прямо по объекту: имя
// встроенного свойства вместо языка вернёт само это свойство, как в эталоне.
export function northLabel(language) {
  const label = NORTH_BY_LANGUAGE[language];
  return label || NORTH_BY_LANGUAGE.ru;
}
