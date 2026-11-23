/*
 * Числительные по-русски.
 *
 * «1 предупреждений» и «2 объекта» — разные ошибки одной природы: русский
 * требует трёх форм там, где английскому хватает двух. Правило выбора уже
 * лежит в браузере (`Intl.PluralRules`), и повторять его руками незачем —
 * достаточно назвать три слова.
 *
 * Здесь, а не рядом с экраном: тем же счётом печатают объекты интерьера,
 * кресла арены и правки HUD. Три копии одного правила разъезжаются на первой
 * же правке — в редакторе интерьеров как раз и стояло «1 ошибок в макете».
 */
/* Объекты `Intl` — при первом обращении, а не при загрузке модуля (30.10.2026, главный модуль): первый из них поднимает данные ICU (~12 мс при ×4 в задаче главного модуля), и платит за это тот, кто загружается первым. */
let russianPluralRules = null;
let russianNumberFormat = null;
const russianPlurals = () => (russianPluralRules ||= new Intl.PluralRules("ru-RU"));
const russianNumbers = () => (russianNumberFormat ||= new Intl.NumberFormat("ru-RU"));

/** @param {[string, string, string]} forms — «объект», «объекта», «объектов» */
export function plural(count, [one, few, many]) {
  switch (russianPlurals().select(count)) {
    case "one":
      return one;
    case "few":
      return few;
    default:
      return many;
  }
}

/** Число со словом: «2 объекта», «5 объектов». */
export const counted = (count, forms) =>
  `${russianNumbers().format(count)} ${plural(count, forms)}`;

/* Размер файла пишет formatSize из catalog-utils.js: один формат с карточкой
   каталога, на языке окна. Здесь был второй — двоичный и всегда латиницей,
   и один и тот же мод весил «5 МБ» в каталоге и «4.5 MB» в сборке. */
