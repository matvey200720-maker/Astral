import { useMemo } from "react";
import Button from "../../ui/Button.jsx";
import Kbd from "../../ui/Kbd.jsx";
import * as Icons from "../../ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import {
  SETTINGS_GROUPS,
  groupOf,
  searchSettings,
  settingsText,
} from "./settings-map.js";
import { SECTION_ICON } from "./settings-icons.jsx";

/*
 * Поиск по настройкам: одна модель на левое меню и на правую часть.
 * Меню гасит разделы без совпадений и ставит число у найденных, а справа
 * встаёт список результатов («Пульт», 15.11.2026): у каждого значок раздела,
 * название и пояснение с подсветкой слов запроса и путь «Группа › Раздел».
 */

// Символы, которые в запросе значат только самих себя.
const REGEX_SPECIALS = new Set([
  ".",
  "*",
  "+",
  "?",
  "^",
  "$",
  "{",
  "}",
  "(",
  ")",
  "|",
  "[",
  "]",
  "\\",
]);
const YO_LETTERS = "еёЕЁ";

// Слово запроса как кусок выражения: спецсимволы экранируются, «е» и «ё» взаимозаменяемы.
const escapeWord = (word) => {
  let source = "";
  for (const char of word) {
    if (REGEX_SPECIALS.has(char)) source += "\\" + char;
    else if (YO_LETTERS.includes(char)) source += "[её]";
    else source += char;
  }
  return source;
};

// Слова запроса — одно выражение с группой: по нему текст режется на куски и совпадения.
const buildMatcher = (query) => {
  const words = query.match(/\S+/g);
  return words ? new RegExp(`(${words.map(escapeWord).join("|")})`, "i") : null;
};

// Без совпадений вернётся сама строка; иначе — список из текста и элементов <mark>.
export const highlight = (text, matcher) => {
  const pieces = matcher ? text.split(matcher) : [text];
  if (pieces.length === 1) return text;

  let offset = 0;
  return pieces.flatMap((piece, index) => {
    const at = offset;
    offset += piece.length;
    if (index % 2 === 1) return [<mark key={at}>{piece}</mark>];
    return piece === "" ? [] : [piece];
  });
};

// Результаты по разделам: сколько нашлось в каждом (раздел без пунктов тоже считается одним).
const countBySection = (results) => {
  const counts = new Map();
  for (const hit of results) {
    counts.set(hit.section, (counts.get(hit.section) ?? 0) + 1);
  }
  return counts;
};

// Группы меню в порядке карты; вкладки — разделы подряд (стрелки ходят по ним все, и погасшие тоже).
const buildMenu = (sections) => {
  const plan = SETTINGS_GROUPS.flatMap((group) => {
    const ids = group.sections.filter((id) => sections.includes(id));
    return ids.length > 0 ? [{ id: group.id, ids }] : [];
  });
  const tabs = plan.flatMap((group) => group.ids).map((value) => ({ value }));
  return { plan, tabs };
};

export function useSettingsSearch(query, language, sections) {
  const results = useMemo(
    () => searchSettings(query, language, sections),
    [query, language, sections],
  );
  const searching = query.trim().length > 0;
  const matcher = useMemo(() => buildMatcher(query), [query]);
  const counts = useMemo(() => countBySection(results), [results]);
  const menu = useMemo(() => buildMenu(sections), [sections]);

  return { counts, matcher, query: query.trim(), results, searching, ...menu };
}

/* «Нашлось N» — число меняет слово, поэтому по языкам, а не одной строкой словаря. */
const FOUND_WORDS = {
  ru: (n) => `Нашлось ${n}`,
  uk: (n) => `Знайшлося ${n}`,
  en: (n) => (n === 1 ? "1 result" : `${n} results`),
  de: (n) => (n === 1 ? "1 Treffer" : `${n} Treffer`),
  pl: (n) => `Znaleziono: ${n}`,
  fr: (n) => (n <= 1 ? `${n} résultat` : `${n} résultats`),
};

export const foundTitle = (language, count) =>
  (FOUND_WORDS[language] || FOUND_WORDS.en)(count);

const Crumb = ({ children }) => (
  <nav className="settings-crumbs">
    <span>{tr("Поиск")}</span>
    <Icons.CaretRight aria-hidden="true" />
    <span aria-current="page">{children}</span>
  </nav>
);

function ResultRow({ hit, first, language, matcher, onOpen }) {
  const text = settingsText(language);
  const Icon = SECTION_ICON[hit.section] ?? Icons.GearSix;
  const [sectionName] = text.sections[hit.section];
  const groupName = text.groups[groupOf(hit.section)];

  return (
    <li>
      <button
        type="button"
        className={`settings-result${first ? " is-first" : ""}`}
        onClick={() => onOpen(hit.section, hit.id)}
      >
        <span className="settings-result-icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="settings-result-copy">
          <b>{highlight(hit.title, matcher)}</b>
          <small>{highlight(hit.hint, matcher)}</small>
        </span>
        <span className="settings-result-where">
          {first ? <Kbd>Enter</Kbd> : null}
          {groupName}
          <Icons.CaretRight aria-hidden="true" />
          {sectionName}
        </span>
      </button>
    </li>
  );
}

/* Правая часть, пока в поиске что-то набрано: найденное по всем разделам или честное «ничего». */
export function SettingsResults({ search, language, onOpen, onClear }) {
  useTr();
  const { matcher, query, results } = search;

  if (results.length === 0) {
    const text = settingsText(language);
    return (
      <div className="settings-results" data-settings-results="empty">
        <header className="settings-section-head">
          <div className="settings-section-head-copy">
            <Crumb>{tr("по всем разделам")}</Crumb>
            <h2>{text.nothing}</h2>
            <p data-audit-ignore="type-scale">
              {trFill("Запрос «{0}»", query)}
            </p>
          </div>
        </header>
        <div className="settings-results-empty" role="status">
          <span className="settings-results-empty-icon" aria-hidden="true">
            <Icons.MagnifyingGlass />
          </span>
          <b>{text.nothing}</b>
          <span>{text.nothingHint}</span>
          <Button
            size="sm"
            className="settings-results-clear"
            onClick={onClear}
          >
            {text.clear}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-results" data-settings-results="found">
      <header className="settings-section-head">
        <div className="settings-section-head-copy">
          <Crumb>{tr("по всем разделам")}</Crumb>
          <h2>{foundTitle(language, results.length)}</h2>
          <p data-audit-ignore="type-scale">
            {trFill("Запрос «{0}». Enter открывает первый результат.", query)}
          </p>
        </div>
      </header>
      <ul className="settings-results-list">
        {results.map((hit, index) => (
          <ResultRow
            key={`${hit.section}/${hit.id ?? "section"}`}
            hit={hit}
            first={index === 0}
            language={language}
            matcher={matcher}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </div>
  );
}
