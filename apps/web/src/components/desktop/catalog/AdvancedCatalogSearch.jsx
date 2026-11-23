import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, MagnifyingGlass, X } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import EmptyState from "../../ui/EmptyState.jsx";
import ModName from "./ModName.jsx";
import StockCoverNote from "./StockCoverNote.jsx";
import { catalogSectionOfMod, publicCatalogCategories } from "./catalogSections.js";
import { publicCatalogPreviewMods } from "./preview-mods.js";
import { modCardKicker } from "../../../catalog-utils.js";
import { catalogPageMods } from "../../../features/catalog/catalog-page-mods.js";
import { catalogLabel } from "../../../features/catalog/catalog-words.js";
import { modIsNew } from "../../../features/catalog/post-order.js";
import { coverFor, hasOwnCover } from "../../../utils/catalogMedia.js";
import { tr, useTr } from "../../../locales/ui.js";

// Слова страницы: русский и украинский столбцы идут через tr, остальные языки берут английский.
const WORD_ROWS = [
  ["eyebrow", "Каталог Astral", "Каталог Astral", "Astral catalog"],
  ["title", "Расширенный поиск", "Розширений пошук", "Advanced search"],
  ["subtitle", "Все модификации в одном месте. Ищите по названию, автору или категории.", "Усі модифікації в одному місці. Шукайте за назвою, автором або категорією.", "Every modification in one place. Search by title, author, or category."],
  ["placeholder", "Название, автор или категория", "Назва, автор або категорія", "Title, author, or category"],
  ["filters", "Фильтры", "Фільтри", "Filters"],
  ["all", "Все моды", "Усі моди", "All mods"],
  ["results", "результатов", "результатів", "results"],
  ["emptyTitle", "Ничего не найдено", "Нічого не знайдено", "Nothing found"],
  ["emptyText", "Измените запрос или сбросьте выбранную категорию.", "Змініть запит або скиньте вибрану категорію.", "Try another query or reset the selected category."],
  ["reset", "Сбросить фильтры", "Скинути фільтри", "Reset filters"],
  ["back", "Вернуться на главную", "Повернутися на головну", "Back to home"],
];

const COLUMN_OF_LANGUAGE = new Map([["ru", 1], ["uk", 2]]);

function wordsOf(language) {
  const column = COLUMN_OF_LANGUAGE.get(language) ?? 3;
  return Object.fromEntries(WORD_ROWS.map((row) => [row[0], column === 3 ? row[3] : tr(row[column])]));
}

// Регистр при поиске: свои правила у русского и украинского, у остальных английские.
const caseLocale = (language) => (language === "ru" || language === "uk" ? language : "en");

const SEARCHABLE = ["name", "author", "description", "categoryLabel", "catalogCategory", "catalogSubcategory"];

const haystackOf = (mod, locale) =>
  SEARCHABLE.map((field) => mod[field])
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase(locale);

// Сначала новые, потом по рейтингу по убыванию; равные остаются как были.
const byFreshness = (one, two) => Number(modIsNew(two)) - Number(modIsNew(one)) || Number(two.rating || 0) - Number(one.rating || 0);

/* «Все» — как «Все» каталога: карточки, скрытые из каталога (`catalogUnlisted` — части редукса, видимые только внутри него, и служебный пакет «Остальные файлы»),
   здесь тоже не всплывают. Раньше категория «Все» брала любой мод выборки, и такие части находились поиском (13.11.2026). */
export function findMods(mods, { query, category, language }) {
  const locale = caseLocale(language);
  const needle = query.trim().toLocaleLowerCase(locale);
  const fits = (mod) => (category === "all" ? !mod.catalogUnlisted : catalogSectionOfMod(mod) === category) && (!needle || haystackOf(mod, locale).includes(needle));
  return mods.filter(fits).sort(byFreshness);
}

// Запрос и категория; заданные снаружи значения заново принимаются, когда меняется любое из них.
function useSearchState(initialFilter) {
  const wantedSearch = initialFilter?.search;
  const wantedCategory = initialFilter?.category;
  const [query, setQuery] = useState(wantedSearch || "");
  const [category, setCategory] = useState(wantedCategory || "all");
  useEffect(() => {
    setQuery(wantedSearch || "");
    setCategory(wantedCategory || "all");
  }, [wantedSearch, wantedCategory]);
  return { query, setQuery, category, setCategory };
}

// Поле получает фокус в первом кадре после открытия; уход до кадра его отменяет.
function useFocusOnOpen() {
  const field = useRef(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      field.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return field;
}

function ResultCard({ mod, caption, language, onSelect }) {
  const kicker = modCardKicker(mod);
  const note = hasOwnCover(mod) ? null : <StockCoverNote language={language} className="is-inline" />;
  const label = mod.categoryLabel || (caption ? catalogLabel(caption, language) : "Astral");
  return createElement(
    "button",
    {
      type: "button",
      className: "advanced-search-card",
      onClick: () => {
        onSelect(mod);
      },
    },
    createElement("i", { style: { backgroundImage: `url('${coverFor(mod)}')` } }),
    createElement("span", null, kicker ? createElement("small", null, kicker) : null, createElement("b", null, <ModName name={mod.name} />), note, createElement("em", null, label)),
    <ArrowRight />,
  );
}

export function AdvancedCatalogSearch({ data, onSelect, onBack, language = "ru", initialFilter = null }) {
  useTr();
  const words = wordsOf(language);
  const { query, setQuery, category, setCategory } = useSearchState(initialFilter);
  const field = useFocusOnOpen();
  const mods = useMemo(() => catalogPageMods(data.mods, publicCatalogPreviewMods), [data.mods]);

  const sections = publicCatalogCategories.filter(({ id }) => id === "all" || mods.some((mod) => catalogSectionOfMod(mod) === id));
  const found = findMods(mods, { query, category, language });
  const reset = () => {
    setQuery("");
    setCategory("all");
  };

  const filters = sections.map(({ id, label, icon: Glyph }) => {
    const active = id === category;
    const buttonProps = { key: id, type: "button", className: active ? "is-active" : "", "aria-pressed": active ? "true" : "false", onClick: () => setCategory(id) };
    return createElement("button", buttonProps, <Glyph />, createElement("span", null, id === "all" ? words.all : catalogLabel(label, language)));
  });
  const clear = query
    ? createElement("button", { type: "button", "aria-label": words.reset, onClick: () => setQuery("") }, <X />)
    : null;
  const results = found.length
    ? createElement(
        "div",
        { className: "advanced-search-grid", "data-assembly-grid": true },
        found.map((mod) => <ResultCard key={mod.id} mod={mod} caption={sections.find(({ id }) => id === catalogSectionOfMod(mod))?.label} language={language} onSelect={onSelect} />),
      )
    : <EmptyState icon={MagnifyingGlass} title={words.emptyTitle} text={words.emptyText} actions={<Button variant="secondary" onClick={reset}>{words.reset}</Button>} />;

  return createElement(
    "section",
    { className: "desktop-page advanced-search-page" },
    createElement(
      "div",
      { className: "advanced-search-toolbar" },
      createElement(
        "div",
        { className: "advanced-search-topline" },
        createElement("button", { type: "button", className: "advanced-search-back", "aria-label": words.back, title: words.back, onClick: onBack }, <ArrowLeft />),
        createElement(
          "label",
          { className: "advanced-search-input" },
          <MagnifyingGlass />,
          createElement("input", { placeholder: words.placeholder, "aria-label": words.placeholder, type: "search", value: query, onChange: (event) => setQuery(event.currentTarget.value), ref: field }),
          clear,
        ),
      ),
      createElement("div", { className: "advanced-search-filters" }, filters),
    ),
    results,
  );
}
