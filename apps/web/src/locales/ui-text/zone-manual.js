/*
 * Ручные записи словаря: строки, которые нельзя перевести автоматически
 * (склейки окончаний, фразы с вставками, где порядок слов решает язык).
 * Русская строка → [uk, en, de, pl].
 */

const REBUILD_FAILED = [
  "Роботу встановлено, але {0} не вдалося перебудувати поверх неї: {1} — {2}.",
  "The work is installed, but {0} could not be rebuilt on top of it: {1} — {2}.",
  "Die Arbeit ist installiert, aber {0} konnte nicht neu darüber aufgebaut werden: {1} — {2}.",
  "Praca została zainstalowana, ale {0} nie udało się przebudować na niej: {1} — {2}.",
];

export const zoneManual = {
  "Работа встала, но {0} не собрались заново поверх неё: {1} — {2}.": REBUILD_FAILED,
  "Работа встала, но {0} не собралась заново поверх неё: {1} — {2}.": REBUILD_FAILED,
};
