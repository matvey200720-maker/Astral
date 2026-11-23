/*
 * Повторная установка идёт с сохранённым выбором (15.11.2026): строка очереди «Загрузок» хранит то, что выбрал человек в окне «Сделать заменёнку» (`clothingChoice`) или в окне тату
 * (`tattooSetChoice`). «Повторить» у неудачной строки ставит карточку каталога заново, но с этим выбором, а не обычной установкой «как дополнение» — без выбора вещь одежды
 * вида «одна вещь на замену» оболочка не ставит (`needs-choice.js`). Модуль без зависимостей: его берёт стартовый кусок оболочки и план сборки.
 */

/** Карточка каталога с выбором, который стоял в строке очереди (если он был). */
export const withSavedChoice = (mod, row) => ({
  ...mod,
  ...(row?.clothingChoice
    ? { clothingChoice: row.clothingChoice }
    : row?.tattooSetChoice
      ? { tattooSetChoice: row.tattooSetChoice }
      : {}),
});

/** Дешёвый признак «это карточка одежды»: по нему решают, нужен ли разбор вида установки (`needs-choice.js` грузится лениво, у модов не одежды его не просят). */
export const looksLikeClothing = (mod) =>
  Boolean(
    mod &&
    (mod.domain?.clothing ||
      mod.clothing ||
      mod.catalogCategory === "clothing" ||
      mod.catalogSection === "clothing"),
  );
