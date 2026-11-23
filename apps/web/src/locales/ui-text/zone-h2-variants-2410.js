/*
 * Зона «Варианты одной вещи одежды» (ТЗ 24.10.2026, п. 6): подписи вариантов одной карточки — пол, вещь, обновление
 * игры, редакция поста. Подпись собирает разбор из слов (`packages/publishing/clothing-variants.js`: «Мужское · Рюкзаки и
 * сумки», «Обновление 11»), а лаунчер переводит её по частям (`variantLabelText` в `catalog-utils.js`).
 * Русская строка → [uk, en, de, pl].
 */
export const zoneH2Variants2410 = {
  "Обновление {count}": ["Оновлення {count}", "Update {count}", "Update {count}", "Aktualizacja {count}"],
  "ред. {count}": ["ред. {count}", "ed. {count}", "Ausg. {count}", "wyd. {count}"],
  "Без сервера": ["Без сервера", "No server", "Ohne Server", "Bez serwera"],
  Уши: ["Вуха", "Ears", "Ohren", "Uszy"],
  Браслеты: ["Браслети", "Bracelets", "Armbänder", "Bransolety"],
};
