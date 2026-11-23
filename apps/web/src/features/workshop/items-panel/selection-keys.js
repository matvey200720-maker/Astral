// Сколько номеров лежит в keys выбора: длина читается у чего угодно (строка и объект с длиной тоже набор).
const keyCount = (selection) => selection?.keys?.length;

export const manySelected = (selection) => keyCount(selection) > 1;

// Одиночный key годится, только если он целое число.
export const selectedKeys = (selection) =>
  keyCount(selection) > 0 ? selection.keys : [selection?.key].filter(Number.isInteger);

// Проверка «номер уже выбран»: множество строится сразу, чтобы ошибки шли в прежнем порядке.
const chosenTest = (selection) => {
  const chosen = new Set(selectedKeys(selection));
  return (key) => chosen.has(key);
};

export const rowToggles = (selection, keys) => {
  const isChosen = chosenTest(selection);
  const missing = keys.flatMap((key) => (isChosen(key) ? [] : [key]));
  return keys.length > 0 && missing.length === 0 ? keys : missing;
};
