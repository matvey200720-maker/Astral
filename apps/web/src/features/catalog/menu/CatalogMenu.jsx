/*
 * Колонка каталога «2.0»: три группы пунктов через черту (`catalog-menu.js`). Разметка и классы те же, что у прежней
 * колонки (`catalog-tree-*`): рамка, затухание краёв, рейка и подсветка текущего пункта берутся из `catalog-browse.css`.
 * Колонка ничего не считает: место каталога приходит снаружи, выбор уходит `onRoute` в то же состояние, что и раньше.
 */
import TreeCollapse from "../../../components/desktop/catalog/TreeCollapse.jsx";
import { CaretDown, SidebarSimple } from "../../../components/ui/icons.jsx";
import useScrollEdges from "../../../components/ui/useScrollEdges.js";
import { useTr } from "../../../locales/ui.js";
import { useRememberedState } from "../../../section-memory.js";
import { leafOfPlace, menuLabel, visibleMenu } from "./catalog-menu.js";
import "./catalog-menu.css";

const STEPS = new Map([
  ["ArrowDown", (at, rows) => Math.min(at + 1, rows.length - 1)],
  ["ArrowUp", (at) => Math.max(at - 1, 0)],
  ["Home", () => 0],
  ["End", (at, rows) => rows.length - 1],
]);

const Cell = ({ name, children }) => (
  <span
    className={`catalog-tree-${name}`}
    aria-hidden={name === "label" ? undefined : "true"}
  >
    {children}
  </span>
);

const Glyph = ({ Icon }) => (Icon ? <Icon /> : null);

/* Тонкий подзаголовок внутри ветки («Мир и зоны» в «Маппинге»): не пункт, фокус и стрелки его пропускают. */
function Subhead({ item, view }) {
  return (
    <li
      className="catalog-tree-subhead"
      role="presentation"
      data-menu-heading={item.id}
    >
      {nameOf(view, item.label)}
    </li>
  );
}

const classOf = (...names) => names.filter(Boolean).join(" ");

const nameOf = (view, label) => menuLabel(view.words, label);

function Leaf({ item, view, nested }) {
  const current = Boolean(view.current) && view.current.id === item.id;
  return (
    <li className="catalog-tree-node" data-menu-item={item.id}>
      <button
        type="button"
        className={classOf(
          "catalog-tree-item",
          nested ? "is-shelf" : "is-section",
          current && "is-current",
        )}
        tabIndex={view.tabbed === item.id ? 0 : -1}
        aria-current={current ? "page" : undefined}
        onClick={() => {
          /* Аккордеон: пункт верхнего уровня сворачивает раскрытую ветку, а пункт внутри ветки её оставляет. */
          if (!nested) view.setOpened([]);
          view.onRoute(item.route);
        }}
      >
        {!nested && (
          <Cell name="icon">
            <Glyph Icon={item.icon} />
          </Cell>
        )}
        <Cell name="label">{nameOf(view, item.label)}</Cell>
      </button>
    </li>
  );
}

function Branch({ item, view }) {
  const holdsCurrent =
    Boolean(view.current) &&
    item.children.some((child) => child.id === view.current.id);
  const open = !view.rail && (holdsCurrent || view.opened.includes(item.id));
  const press = () => {
    /* Подзаголовок — не пункт: ветка ведёт в первый вид. */
    const first = item.children.find((child) => !child.heading);
    if (view.rail) {
      view.onRoute(first.route);
      return;
    }
    if (!holdsCurrent && !open) {
      view.setOpened([item.id]);
      view.onRoute(first.route);
      return;
    }
    view.setOpened(open && !holdsCurrent ? [] : [item.id]);
  };
  return (
    <li className="catalog-tree-node is-section" data-menu-item={item.id}>
      <button
        type="button"
        className={classOf(
          "catalog-tree-item",
          "is-section",
          holdsCurrent && "is-trail",
        )}
        tabIndex={view.tabbed === item.id ? 0 : -1}
        aria-expanded={view.rail ? undefined : open}
        onClick={press}
      >
        <Cell name="icon">
          <Glyph Icon={item.icon} />
        </Cell>
        <Cell name="label">{nameOf(view, item.label)}</Cell>
        <Cell name="caret">
          <CaretDown />
        </Cell>
      </button>
      <TreeCollapse open={open}>
        {() => (
          <ul className="catalog-tree-children" role="list">
            {item.children.map((child) =>
              child.heading ? (
                <Subhead key={child.id} item={child} view={view} />
              ) : (
                <Leaf key={child.id} item={child} view={view} nested />
              ),
            )}
          </ul>
        )}
      </TreeCollapse>
    </li>
  );
}

function handleKey(event, view) {
  const rows = Array.from(
    event.currentTarget.querySelectorAll(".catalog-tree-item"),
  ).filter((row) => !view.rail || !row.closest(".catalog-tree-collapse"));
  const at = rows.indexOf(document.activeElement);
  if (at < 0) return;
  const step = STEPS.get(event.key);
  if (step) {
    event.preventDefault();
    rows[step(at, rows)]?.focus();
    return;
  }
  const row = rows[at];
  const state = row.getAttribute("aria-expanded");
  const id = row.closest("[data-menu-item]")?.dataset.menuItem;
  /* Стрелки раскрывают и сворачивают ветку на месте: выбор остаётся там, где был; в место ведёт только щелчок. */
  if (event.key === "ArrowRight" && state === "false") {
    event.preventDefault();
    view.setOpened([id]);
  } else if (event.key === "ArrowRight" && state === "true") {
    event.preventDefault();
    rows[at + 1]?.focus();
  } else if (event.key === "ArrowLeft" && state === "true") {
    event.preventDefault();
    view.setOpened([]);
  } else if (event.key === "ArrowLeft") {
    const outer = row
      .closest(".catalog-tree-node")
      ?.parentElement?.closest(".catalog-tree-node");
    const up =
      outer &&
      Array.from(outer.children).find((child) =>
        child.matches(".catalog-tree-item"),
      );
    if (up) {
      event.preventDefault();
      up.focus();
    }
  }
}

function Bar({ view }) {
  const { words, expanded, rail, search, onOpenChange, setOwnOpen } = view;
  const caption = expanded ? words.collapseNavigator : words.expandNavigator;
  const lead =
    !rail && search ? (
      search
    ) : (
      <span className="catalog-navigator-heading">
        {words.navigatorHeading}
      </span>
    );
  const flip = () =>
    onOpenChange ? onOpenChange(!expanded) : setOwnOpen(!expanded);
  return (
    <div className="catalog-navigator-bar">
      {lead}
      <button
        aria-expanded={expanded}
        aria-label={caption}
        className="catalog-navigator-toggle"
        onClick={flip}
        title={caption}
        type="button"
      >
        <SidebarSimple aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * @param {object} props
 * @param {{category: string, shelfId?: string, groupId?: string}} props.place — где сейчас каталог
 * @param {(route: object) => void} props.onRoute — выбор пункта: `{category, shelf?, group?}`
 * @param {object} props.words — слова каталога (`catalogWordsFor`): подписи колонки
 * @param {*} [props.search] — поле поиска над меню
 * @param {boolean} [props.open] — раскрыта ли колонка (иначе рейка); не задано — память самой колонки
 * @param {(open: boolean) => void} [props.onOpenChange]
 * @param {Map<string, number>} [props.counts] — сколько модов на каждой полке «Маппинга» и вещей в каждом виде «Одежды» для выбранного сервера (одна карта, id не пересекаются): пустые виды прячутся
 */
export default function CatalogMenu({
  place,
  onRoute,
  words,
  search = null,
  open,
  onOpenChange,
  counts = null,
}) {
  useTr();
  const [ownOpen, setOwnOpen] = useRememberedState("catalog-menu:open", true);
  const [opened, setOpened] = useRememberedState("catalog:menu-opened", []);
  const [scrollRef, edges] = useScrollEdges();
  const expanded = open ?? ownOpen;
  const current = leafOfPlace(place);
  const groups = visibleMenu(undefined, { counts, keep: current?.id });
  const parent =
    current &&
    groups
      .flat()
      .find((item) => item.children?.some((child) => child.id === current.id));
  /* Одна остановка Tab на колонку: у текущего пункта, а если ветка свёрнута или это рейка — у её родителя. */
  const hidden =
    parent && (!expanded || !(opened.includes(parent.id) || current));
  const tabbed = (hidden ? parent : current || groups[0][0]).id;
  const view = {
    words,
    expanded,
    rail: !expanded,
    search,
    onOpenChange,
    setOwnOpen,
    current,
    tabbed,
    opened,
    setOpened,
    onRoute,
  };
  return (
    <aside
      className="catalog-navigator"
      aria-label={words.navigatorLabel}
      data-open={expanded ? "true" : undefined}
      data-scroll={edges || undefined}
      ref={scrollRef}
    >
      <Bar view={view} />
      <nav
        className="catalog-tree catalog-menu"
        aria-label={words.categoriesLabel}
        data-selected-category={place.category}
        onKeyDown={(event) => handleKey(event, view)}
      >
        {groups.map((items, at) => (
          <ul
            className="catalog-tree-list"
            role="list"
            key={at}
            data-menu-group={at}
          >
            {items.map((item) =>
              item.children ? (
                <Branch key={item.id} item={item} view={view} />
              ) : (
                <Leaf key={item.id} item={item} view={view} />
              ),
            )}
          </ul>
        ))}
      </nav>
    </aside>
  );
}
