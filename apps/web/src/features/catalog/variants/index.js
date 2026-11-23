import { createElement, lazy, Suspense } from "react";

/*
 * Три вида вкладки «Каталог» на выбор владельца (ТЗ 29.10.2026-б; как было с «Компонентами»).
 *
 * В приложении вкладка остаётся прежней, пока владелец не выберет. Варианты живут только в песочнице (`?qa=isolated`), чтобы снять их на
 * одном и том же каталоге и отправить на выбор. Флаг — `qa-catalog-variant=a|b|c` в строке запроса или в `localStorage` (то же имя):
 *
 *  • `a` — витрина: баннер раздела, полки подразделов с прокруткой вбок, «Новое» и «Популярное» (`a/CatalogVariantA.jsx`);
 *  • `b` — плотный список и таблица: подразделы-чипами сверху, строка на мод, сетка/список (`b/CatalogVariantB.jsx`);
 *  • `c` — третий вариант (`c/CatalogVariantC.jsx`, Х3).
 *
 * Вид — весь экран вкладки, не только сетка, поэтому он получает всё состояние `PublicCatalog` одним пропом `model` (собран там из
 * уже посчитанных значений, логики в видах нет): место (`category`, `shelf`, `title`, `status`), колонка (`navigatorProps` для
 * `CatalogNavigator`), поиск (`search`, `searchField`), порядок и фильтры (`menuOptions`, `favoritesOnly`, `size`), результаты
 * (`visibleMods`, `gridItems`, `renderCard`, `emptyResult()`), действия (`chooseCategory`, `chooseShelfIn`, `selectCard`,
 * `toggleFavorite`) и числа (`sectionCounts`, `shelfCounts`, `labelCounts`). Полный список — в `PublicCatalog.jsx`, рядом с флагом.
 *
 * Вид — файл `<вариант>/CatalogVariant<Буква>.jsx` с `export default function ({ model })`. Подключать его никуда не надо: список
 * файлов ловит `import.meta.glob`, пока файла нет — флаг показывает прежний вид. Лист вида — рядом с ним, лениво (`@layer`,
 * `import "./….css"` из самого вида; гейт архитектуры берёт всё под `features/catalog/variants/` как ленивые листы).
 */

export const CATALOG_VARIANTS = Object.freeze(["a", "b", "c"]);

const STORAGE_KEY = "qa-catalog-variant";

const FILES = Object.freeze({
  a: "./a/CatalogVariantA.jsx",
  b: "./b/CatalogVariantB.jsx",
  c: "./c/CatalogVariantC.jsx",
});

/* Только те файлы, что есть: вид Х3 приезжает отдельным коммитом. */
const loaders = import.meta.glob([
  "./a/CatalogVariantA.jsx",
  "./b/CatalogVariantB.jsx",
  "./c/CatalogVariantC.jsx",
]);

const views = new Map();

function viewOf(variant) {
  if (!views.has(variant)) {
    const load = loaders[FILES[variant]];
    views.set(variant, load ? lazy(load) : null);
  }
  return views.get(variant);
}

const readStored = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

/**
 * Какой вид вкладки «Каталог» включён флагом песочницы; пустая строка — прежний вид (всегда в приложении).
 * @param {string} [search] строка запроса (`location.search`); в тестах подставляют свою.
 * @param {() => string} [stored] значение из хранилища; в тестах подставляют своё.
 */
export function catalogVariantOf(
  search = typeof window === "undefined" ? "" : window.location.search,
  stored = typeof window === "undefined" ? () => "" : readStored,
) {
  const query = new URLSearchParams(search);
  if (query.get("qa") !== "isolated") return "";
  const value = String(query.get(STORAGE_KEY) || stored() || "").toLowerCase();
  return CATALOG_VARIANTS.includes(value) ? value : "";
}

/** Вид вкладки; пока его файла нет или кусок едет — прежний вид (`fallback`). */
export function CatalogVariant({ variant, model, fallback = null }) {
  const View = viewOf(variant);
  if (!View) return fallback;
  return createElement(
    Suspense,
    { fallback },
    createElement(View, { model }),
  );
}
