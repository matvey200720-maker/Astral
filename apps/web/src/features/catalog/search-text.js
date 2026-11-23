/*
 * Поиск каталога глазами игрока.
 *
 * Каталог после выгрузки Discord — тысячи модов, и ищут в нём с клавиатуры,
 * на которой две раскладки. «ljhfuty» вместо «драгон», «ршпр» вместо
 * «high», «ё» то написано, то нет — и честный поиск по подстроке отвечает
 * «ничего не нашлось» на мод, который лежит на первом экране.
 *
 * Здесь два шага: текст и запрос складываются одинаково (строчные, «ё» как
 * «е», пробелы — одним), а запрос, который ничего не нашёл, можно
 * переложить на другую раскладку. Перекладка — второй шаг, а не всегда:
 * короткий запрос в чужой раскладке совпал бы с половиной каталога.
 */

/*
 * Одна и та же клавиша в двух раскладках, по парам: буквы, знаки на месте
 * русских букв и те же знаки с Shift («{» — это «Х», «:» — «Ж», «<» — «Б»),
 * а ещё клавиша «/» — русская точка, «?» — русская запятая. Регистр не нужен:
 * запрос сначала складывается в строчные.
 */
const EN_KEYS = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./~{}:\"<>?";
const RU_KEYS = "ёйцукенгшщзхъфывапролджэячсмитьбю.ёхъжэбю,";
const TO_RU = new Map([...EN_KEYS].map((key, index) => [key, RU_KEYS[index]]));
/* Обратно — первая пара выигрывает: «х» — это «[», а не «{». */
const TO_EN = new Map();
[...RU_KEYS].forEach((key, index) => {
  if (!TO_EN.has(key)) TO_EN.set(key, EN_KEYS[index]);
});

/** Текст для сравнения: строчные, «ё» = «е», пробелы — одним. */
export function foldSearchText(text) {
  return String(text || "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Запрос, набранный в другой раскладке, или `null`, если перекладывать
 * нечего: в запросе меньше двух букв, буквы обеих раскладок сразу или
 * перекладка ничего не меняет.
 */
export function swapKeyboardLayout(query) {
  const text = String(query || "").toLocaleLowerCase("ru");
  const latin = (text.match(/[a-z]/g) || []).length;
  const cyrillic = (text.match(/[а-яё]/g) || []).length;
  /* Раскладку выдают буквы: латиница — набирали по-русски на английской,
     кириллица — наоборот. Обе сразу — это не опечатка раскладки. */
  if ((latin && cyrillic) || !(latin || cyrillic)) return null;
  const table = latin ? TO_RU : TO_EN;
  const keys = [...text].filter((char) => table.has(char)).length;
  if (keys < 2) return null;
  const swapped = foldSearchText(
    [...text].map((char) => table.get(char) ?? char).join(""),
  );
  return swapped && swapped !== foldSearchText(text) ? swapped : null;
}
