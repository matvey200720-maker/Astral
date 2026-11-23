import Kbd from "../../ui/Kbd.jsx";
import { useEffect, useRef } from "react";
import * as Icons from "../../ui/icons.jsx";
import { hotkey } from "../../../utils/hotkeys.js";
import { settingsText } from "./settings-map.js";
import { SECTION_ICON } from "./settings-icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import useTabListKeys from "../../ui/useTabListKeys.js";

/*
 * Левая колонка настроек («Пульт», 15.11.2026): заголовок, поиск и разделы по группам. У раздела справа — то, что в нём стоит
 * сейчас (`settings-live.jsx`); пока в поиске что-то набрано, разделы без совпадений гаснут, а у найденных — число.
 * Сами результаты стоят справа (`settings-search.jsx`). «Назад» здесь нет: окно закрывают Esc, рейка и кнопка мыши «назад».
 */

const iconFor = (id) => SECTION_ICON[id] ?? Icons.GearSix;

const listen = (target, type, handler) => {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
};

const isFindCombo = (event) =>
  (event.ctrlKey || event.metaKey) && !event.altKey && hotkey(event) === "f";

const focusSearchOn = (inputRef) => (event) => {
  if (!isFindCombo(event)) return;
  event.preventDefault();
  const input = inputRef.current;
  input?.focus();
  input?.select();
};

// Горячая клавиша Ctrl+F (⌘F) на окне переводит фокус в поиск и выделяет введённое.
const useSearchShortcut = (inputRef) => {
  useEffect(
    () => listen(window, "keydown", focusSearchOn(inputRef)),
    [inputRef],
  );
};

// Клавиша в поле поиска → что делать (или null, если делать нечего).
// Esc при пустом запросе и Enter без результатов не гасят событие.
const SEARCH_KEYS = new Map([
  ["Escape", ({ query, onQuery }) => (query ? () => onQuery("") : null)],
  [
    "Enter",
    ({ results, onOpen }) => {
      const [first] = results;
      return first ? () => onOpen(first.section, first.id) : null;
    },
  ],
]);

const tabListConfig = (options, value, onChange) => ({
  options,
  value,
  onChange,
  orientation: "vertical",
});

/* Пока набран запрос, подсказка «Esc» стоит на месте «Ctrl F» и сама очищает поле. */
const SearchTail = ({ query, label, onClear }) => {
  if (!query) return <Kbd>Ctrl F</Kbd>;

  return (
    <button
      type="button"
      className="settings-search-clear"
      aria-label={label}
      title={label}
      onClick={onClear}
    >
      <Kbd>Esc</Kbd>
    </button>
  );
};

const SearchField = (props) => {
  const { text, query, inputRef, onQuery, onKeyDown, onClear } = props;
  const { search: searchLabel, clear: clearLabel } = text;
  const handleChange = (event) => onQuery(event.target.value);

  return (
    <label className="settings-search">
      <Icons.MagnifyingGlass aria-hidden="true" />
      <input
        ref={inputRef}
        placeholder={searchLabel}
        aria-label={searchLabel}
        type="search"
        value={query}
        onChange={handleChange}
        onKeyDown={onKeyDown}
      />
      <SearchTail query={query} label={clearLabel} onClear={onClear} />
    </label>
  );
};

const SectionTab = (props) => {
  const { id, text, selected, shown, dotted, dim, found, meta, onOpen } = props;
  const Icon = iconFor(id);
  const [name, summary] = text.sections[id];
  const open = () => onOpen(id);
  const dot = dotted ? (
    <i className="settings-nav-dot" aria-label={text.changed} />
  ) : null;
  /* Число найденного встаёт на место значения: у раздела не бывает двух значков справа. */
  const aside =
    found > 0 ? (
      <span className="settings-nav-count">{found}</span>
    ) : meta ? (
      <span className="settings-nav-meta">{meta}</span>
    ) : null;
  const classes = ["settings-nav-item", shown && "is-active", dim && "is-dim"];

  return (
    <button
      type="button"
      role="tab"
      id={`settings-tab-${id}`}
      className={classes.filter(Boolean).join(" ")}
      aria-selected={selected}
      aria-controls="settings-section-panel"
      tabIndex={Number(selected) - 1}
      title={summary}
      onClick={open}
    >
      <Icon aria-hidden="true" />
      <span className="settings-nav-name" data-audit-ignore="type-scale">
        {name}
      </span>
      {dot}
      {aside}
    </button>
  );
};

const MenuGroup = (props) => {
  const { group, text, active, changed, search, meta, onOpen } = props;
  const entries = group.ids.map((id) => (
    <SectionTab
      key={id}
      id={id}
      text={text}
      selected={active === id}
      shown={!search.searching && active === id}
      dotted={changed[id] > 0}
      dim={search.searching && !search.counts.has(id)}
      found={search.searching ? (search.counts.get(id) ?? 0) : 0}
      meta={meta[id]}
      onOpen={onOpen}
    />
  ));

  return (
    <div className="settings-nav-group">
      <span
        className="settings-nav-group-title"
        aria-hidden="true"
        data-audit-ignore="caps"
      >
        {text.groups[group.id]}
      </span>
      {entries}
    </div>
  );
};

function SettingsNav({
  active,
  changed = {},
  language,
  meta = {},
  onOpen,
  onQuery,
  query,
  search,
}) {
  useTr();
  const inputRef = useRef(null);
  const text = settingsText(language);
  const { listRef, onKeyDown: onTabKeyDown } = useTabListKeys(
    tabListConfig(search.tabs, active, (sectionId) => onOpen(sectionId)),
  );
  useSearchShortcut(inputRef);

  const handleSearchKey = (event) => {
    const resolveAction = SEARCH_KEYS.get(event.key);
    const action = resolveAction?.({
      onOpen,
      onQuery,
      query,
      results: search.results,
    });
    if (!action) return;
    event.preventDefault();
    action();
  };

  const clearQuery = () => {
    onQuery("");
    inputRef.current?.focus();
  };

  const groups = search.plan.map((group) => (
    <MenuGroup
      key={group.id}
      active={active}
      changed={changed}
      group={group}
      meta={meta}
      onOpen={onOpen}
      search={search}
      text={text}
    />
  ));

  return (
    <aside aria-label={text.menu} className="settings-nav">
      <div className="settings-nav-title" aria-hidden="true">
        <b data-audit-ignore="type-scale">{tr("Настройки")}</b>
        <small>{tr("Всё применяется сразу")}</small>
      </div>
      <SearchField
        inputRef={inputRef}
        onClear={clearQuery}
        onKeyDown={handleSearchKey}
        onQuery={onQuery}
        query={query}
        text={text}
      />
      <div
        aria-label={text.menu}
        aria-orientation="vertical"
        className="settings-nav-groups"
        onKeyDown={onTabKeyDown}
        ref={listRef}
        role="tablist"
      >
        {groups}
      </div>
    </aside>
  );
}

export default SettingsNav;
