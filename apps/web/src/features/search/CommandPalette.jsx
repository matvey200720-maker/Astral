import { useEffect, useMemo, useRef, useState } from "react";
// Поиск и данные каталога
import { swapKeyboardLayout, foldSearchText } from "../catalog/search-text.js";
import { textMatchesQuery, conceptTokens } from "../catalog/search-concepts.js";
import { isPlaceholderAuthor } from "../catalog/catalog-authors.js";
import { newestFirst } from "../catalog/post-order.js";
import { shelfCatalogMods } from "../../catalog-utils.js";
import { usesWeaponMedia, coverFor } from "../../utils/catalogMedia.js";
import { remember } from "../../section-memory.js";
// Разделы и настройки окна
import { utilityLabels } from "../../components/desktop/navigation/navigationRail.js";
import { desktopNavigationItems } from "../../components/desktop/navigation/DesktopNavigation.jsx";
import { searchSettings } from "../../components/desktop/settings/settings-map.js";
// Отрисовка
import { useTr, tr } from "../../locales/ui.js";
import DesktopOverlayPortal from "../../components/desktop/overlays/DesktopOverlayPortal.jsx";
import ModName from "../../components/desktop/catalog/ModName.jsx";
import {
  SlidersHorizontal,
  MagnifyingGlass,
  GearSix,
  DownloadSimple,
  ArrowRight,
  UserCircle,
} from "../../components/ui/icons.jsx";

const LIST_ID = "astral-palette-list";
const ROW_ID_PREFIX = "astral-palette-";
const SETTINGS_MEMORY_KEY = "settings:section";
// Общий пустой список: ссылка не меняется, значит список не пересчитывается зря.
const NO_MODS = [];
// Сколько строк даёт каждый источник.
const CAPS = { found: 6, fresh: 4, settings: 5 };
// Шаг активной строки на стрелках.
const ARROW_STEPS = new Map([
  ["ArrowDown", 1],
  ["ArrowUp", -1],
]);
const CHORD_MODIFIERS = ["ctrlKey", "metaKey"];
// Поля мода, по которым ищем.
const SEARCHED_FIELDS = ["name", "author", "description", "categoryLabel"];

// Русские ключи словаря: переводятся там, где рисуются, а не при загрузке модуля.
const GROUP_TITLES = {
  found: "Моды",
  fresh: "Новое в каталоге",
  pages: "Разделы",
  settings: "Настройки",
};

const EMPTY_VIEW = { groups: [], rows: [] };

const rowDomId = (index) => `${ROW_ID_PREFIX}${index}`;

// Индекс всегда внутри списка; в пустом списке это 0.
const clampIndex = (value, size) =>
  Math.min(Math.max(value, 0), Math.max(size - 1, 0));

const isToggleChord = (event) =>
  event.code === "KeyK" && CHORD_MODIFIERS.some((name) => event[name]);

/* ---------- окно и клавиатура ---------- */

// Вешает обработчик нажатий на всё окно и отдаёт функцию, которая его снимает.
function listenForChord(matches, run) {
  const onKey = (event) => {
    if (!matches(event)) return;
    event.preventDefault();
    run();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

function focusOnNextFrame(inputRef) {
  const frame = requestAnimationFrame(() => inputRef.current?.focus());
  return () => cancelAnimationFrame(frame);
}

function revealRow(index) {
  const node = document.getElementById(rowDomId(index));
  node?.scrollIntoView({ block: "nearest" });
}

/* ---------- откуда берутся строки ---------- */

// Сначала mods, потом runtimeMods; первая запись с таким id побеждает. Скрытые (internal)
// отбрасываются уже после этого, поэтому скрытая первая запись прячет и вторую.
function visibleMods(mods, runtimeMods) {
  const firstById = new Map();
  for (const entry of [...mods, ...runtimeMods]) {
    const id = entry?.id;
    if (id && !firstById.has(id)) firstById.set(id, entry);
  }
  return [...firstById.values()].filter((mod) => !mod.internal);
}

function searchBlob(mod) {
  const plain = SEARCHED_FIELDS.map((field) => mod[field]).join(" ");
  const tokens = Array.from(conceptTokens(mod));
  tokens.push(foldSearchText(plain));
  return tokens.join(" ");
}

function findMods(shelf, folded) {
  const indexed = shelf.map((mod) => [mod, searchBlob(mod)]);
  const search = (needle) =>
    indexed
      .filter(([, blob]) => textMatchesQuery(blob, needle))
      .map(([mod]) => mod);

  let hits = search(folded);
  if (hits.length === 0) {
    const swapped = swapKeyboardLayout(folded);
    if (swapped) hits = search(swapped);
  }
  return hits.slice(0, CAPS.found);
}

// Автор показывается, если он настоящий, а не заглушка.
function credit(author) {
  if (!author) return "";
  return isPlaceholderAuthor(author) ? "" : author;
}

function modRows({ typed, folded, mods, runtimeMods }) {
  const shelf = shelfCatalogMods(visibleMods(mods, runtimeMods));
  let picked;
  if (typed) picked = findMods(shelf, folded);
  else picked = newestFirst(shelf).slice(0, CAPS.fresh);
  return picked.map((mod) => ({
    kind: "mod",
    mod,
    title: mod.name,
    caption: credit(mod.author),
  }));
}

function pageRows({ language, isAdmin, folded }) {
  const labels = utilityLabels[language] ?? utilityLabels.en;
  const entries = [...desktopNavigationItems(language, isAdmin)];
  entries.push(
    ["downloads", labels[0], DownloadSimple],
    // Профиль в приложении (макет 15.11.2026): страница без пункта в рейке, её открывает палитра.
    ["profile", tr("Профиль"), UserCircle],
    ["settings", labels[1], GearSix],
  );

  const rows = [];
  for (const [pageId, label, Icon] of entries) {
    if (!foldSearchText(label).includes(folded)) continue;
    rows.push({ kind: "page", title: label, caption: "", Icon, pageId });
  }
  return rows;
}

function settingRows({ needle, language }) {
  const rows = [];
  for (const entry of searchSettings(needle, language).slice(
    0,
    CAPS.settings,
  )) {
    rows.push({
      kind: "setting",
      title: entry.title,
      caption: entry.hint,
      Icon: SlidersHorizontal,
      section: entry.section,
    });
  }
  return rows;
}

// Группы идут в этом порядке; каждая знает, чем подписана и как набирает строки.
const SOURCES = [
  {
    id: "mods",
    heading: (typed) => (typed ? GROUP_TITLES.found : GROUP_TITLES.fresh),
    collect: modRows,
  },
  { id: "pages", heading: () => GROUP_TITLES.pages, collect: pageRows },
  {
    id: "settings",
    heading: () => GROUP_TITLES.settings,
    collect: (request) => (request.typed ? settingRows(request) : []),
  },
];

// Строки всех групп нумеруются подряд, одним счётом на весь список.
function buildView({ query, ...scope }) {
  const needle = query.trim();
  const request = {
    ...scope,
    needle,
    typed: needle.length > 0,
    folded: foldSearchText(query),
  };

  const groups = [];
  const rows = [];
  for (const source of SOURCES) {
    const found = source.collect(request);
    if (found.length === 0) continue;
    const numbered = found.map((row, at) => ({
      ...row,
      index: rows.length + at,
    }));
    rows.push(...numbered);
    groups.push({
      id: source.id,
      title: source.heading(request.typed),
      rows: numbered,
    });
  }
  return { groups, rows };
}

// Что делает выбор строки каждого вида.
const OPENERS = {
  mod: (row, { onSelect }) => onSelect?.(row.mod),
  page: (row, { onNavigate }) => onNavigate?.(row.pageId),
  setting: (row, { onNavigate }) => {
    remember(SETTINGS_MEMORY_KEY, row.section);
    onNavigate?.("settings");
  },
};

/* ---------- разметка ---------- */

function CoverLead({ row }) {
  const { mod } = row;
  const src = coverFor(mod);
  const weaponFlag = usesWeaponMedia(mod) ? "true" : undefined;
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      loading="lazy"
      data-render={weaponFlag}
    />
  );
}

function IconLead({ row }) {
  const { Icon } = row;
  return (
    <span className="astral-palette-icon" aria-hidden="true">
      <Icon />
    </span>
  );
}

const LEAD_BY_KIND = { mod: CoverLead, page: IconLead, setting: IconLead };

function PaletteRow({ row, selected, onHover, onChoose }) {
  const { index, kind, title, caption } = row;
  const Lead = LEAD_BY_KIND[kind];
  const itemClass = [
    "astral-palette-item",
    `is-${kind}`,
    selected && "is-active",
  ]
    .filter(Boolean)
    .join(" ");
  const name = kind === "mod" ? <ModName name={title}>{title}</ModName> : title;
  const note = caption ? <small>{caption}</small> : null;
  const hover = () => onHover(index);
  const choose = () => onChoose(row);
  return (
    <button
      type="button"
      role="option"
      id={rowDomId(index)}
      data-index={index}
      aria-selected={String(selected)}
      className={itemClass}
      onMouseMove={hover}
      onClick={choose}
    >
      <Lead row={row} />
      <span className="astral-palette-copy">
        <b>{name}</b>
        {note}
      </span>
      <ArrowRight className="astral-palette-go" />
    </button>
  );
}

function PaletteGroup({ title, rows, current, onHover, onChoose }) {
  const items = rows.map((row) => (
    <PaletteRow
      key={row.index}
      row={row}
      selected={row.index === current}
      onHover={onHover}
      onChoose={onChoose}
    />
  ));
  return (
    <section className="astral-palette-group">
      <h3>{tr(title)}</h3>
      {items}
    </section>
  );
}

function EmptyNote() {
  return <p className="astral-palette-empty">{tr("Ничего не найдено")}</p>;
}

function ResultList({ groups, current, onHover, onChoose }) {
  const sections = groups.map(({ id, title, rows }) => (
    <PaletteGroup
      key={id}
      title={title}
      rows={rows}
      current={current}
      onHover={onHover}
      onChoose={onChoose}
    />
  ));
  return (
    <div className="astral-palette-list" role="listbox" id={LIST_ID}>
      {groups.length > 0 ? sections : <EmptyNote />}
    </div>
  );
}

function SearchField({ inputRef, value, onType, activeId }) {
  const hint = tr("Найти мод, раздел или настройку");
  return (
    <label className="astral-palette-field">
      <MagnifyingGlass />
      <input
        ref={inputRef}
        value={value}
        onChange={onType}
        aria-label={hint}
        placeholder={hint}
        aria-controls={LIST_ID}
        aria-activedescendant={activeId}
      />
      <kbd>Esc</kbd>
    </label>
  );
}

function FootHint({ keys, word }) {
  const caps = keys.map((cap) => <kbd key={cap}>{cap}</kbd>);
  return (
    <span>
      {caps}
      {` ${word}`}
    </span>
  );
}

function FootBar() {
  return (
    <footer className="astral-palette-foot">
      <FootHint keys={["↑", "↓"]} word={tr("выбрать")} />
      <FootHint keys={["Enter"]} word={tr("открыть")} />
      <FootHint keys={["Ctrl", "K"]} word={tr("закрыть")} />
    </footer>
  );
}

function PaletteScrim({ onPress, children }) {
  return (
    <div className="astral-palette-scrim" onMouseDown={onPress}>
      {children}
    </div>
  );
}

function PaletteFrame({ onKeyDown, children }) {
  const label = tr("Поиск по Astral");
  return (
    <div
      className="astral-palette"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

function PaletteDialog({
  groups,
  current,
  query,
  inputRef,
  activeId,
  onHover,
  onChoose,
  onType,
  onKeys,
  onScrimPress,
}) {
  return (
    <DesktopOverlayPortal>
      <PaletteScrim onPress={onScrimPress}>
        <PaletteFrame onKeyDown={onKeys}>
          <SearchField
            inputRef={inputRef}
            value={query}
            onType={onType}
            activeId={activeId}
          />
          <ResultList
            groups={groups}
            current={current}
            onHover={onHover}
            onChoose={onChoose}
          />
          <FootBar />
        </PaletteFrame>
      </PaletteScrim>
    </DesktopOverlayPortal>
  );
}

export default function CommandPalette(props) {
  useTr();
  const {
    defaultOpen = false,
    isAdmin = false,
    language = "ru",
    mods = NO_MODS,
    onNavigate,
    onSelect,
    runtimeMods = NO_MODS,
  } = props;

  const startsOpen = Boolean(defaultOpen);
  const [open, setOpen] = useState(startsOpen);
  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  const { groups, rows } = useMemo(() => {
    if (!open) return EMPTY_VIEW;
    return buildView({ query, language, isAdmin, mods, runtimeMods });
  }, [query, open, isAdmin, mods, language, runtimeMods]);
  const current = clampIndex(cursor, rows.length);

  // Ctrl/Cmd+K работает всегда, в том числе пока палитра закрыта.
  useEffect(
    () => listenForChord(isToggleChord, () => setOpen((wasOpen) => !wasOpen)),
    [],
  );

  // Каждое открытие начинается с пустого поля; фокус встаёт на следующем кадре.
  useEffect(() => {
    if (!open) return undefined;
    setCursor(0);
    setQuery("");
    return focusOnNextFrame(inputRef);
  }, [open]);

  useEffect(() => {
    revealRow(current);
  }, [current]);

  const dismiss = () => setOpen(false);

  const choose = (row) => {
    dismiss();
    if (row) OPENERS[row.kind](row, { onSelect, onNavigate });
  };

  const onKeys = (event) => {
    const { key } = event;
    const step = ARROW_STEPS.get(key);
    if (step !== undefined) {
      setCursor(clampIndex(current + step, rows.length));
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      choose(rows[current]);
    } else if (key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      dismiss();
    }
  };

  const onScrimPress = (event) => {
    if (event.currentTarget === event.target) dismiss();
  };

  const onType = (event) => {
    setCursor(0);
    setQuery(event.target.value);
  };

  return open ? (
    <PaletteDialog
      groups={groups}
      current={current}
      query={query}
      inputRef={inputRef}
      activeId={rows.length > 0 ? rowDomId(current) : undefined}
      onHover={setCursor}
      onChoose={choose}
      onType={onType}
      onKeys={onKeys}
      onScrimPress={onScrimPress}
    />
  ) : null;
}
