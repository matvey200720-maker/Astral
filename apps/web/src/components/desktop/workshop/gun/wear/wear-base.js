/*
 * «Основа из каталога» (ТЗ 29.10.2026-d): чистые функции — поиск, проект и порядок карточек. Без React.
 */

/* Порядок карточек: по скачиваниям — самые ходовые первыми, по названию — по алфавиту; при равенстве — как в каталоге. */
export const BASE_SORTS = Object.freeze(["downloads", "name"]);

const fold = (value) =>
  String(value || "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е");

/** Проекты, под которые есть вещи в списке: id в порядке `order` (список проектов каталога), без повторов. */
export function baseProjects(items, order) {
  const present = new Set(items.flatMap((item) => item.projects || []));
  return order.filter((id) => present.has(id));
}

/** Карточки по запросу, проекту (`all` — любой) и порядку; исходный список не меняется. */
export function baseCards(items, { query = "", project = "all", sort = "downloads" } = {}) {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  const kept = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => project === "all" || (item.projects || []).includes(project))
    .filter(({ item }) => {
      const text = fold(item.name);
      return tokens.every((token) => text.includes(token));
    });
  const by =
    sort === "name"
      ? (a, b) => fold(a.item.name).localeCompare(fold(b.item.name), "ru") || a.index - b.index
      : (a, b) => (Number(b.item.downloads) || 0) - (Number(a.item.downloads) || 0) || a.index - b.index;
  return kept.sort(by).map(({ item }) => item);
}
