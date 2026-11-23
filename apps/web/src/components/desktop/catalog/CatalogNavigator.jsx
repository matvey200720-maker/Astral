import { useEffect, useRef } from "react";
import { editorGroupOf as Editors_editorGroupOf, EDITOR_GROUPS as Editors_EDITOR_GROUPS } from "../../../features/catalog/redux-editors.js";
import { useRememberedState as Memory_useRememberedState } from "../../../section-memory.js";
import { CaretDown as Icons_CaretDown, SidebarSimple as Icons_SidebarSimple } from "../../ui/icons.jsx";
import AccountAvatar from "../../ui/AccountAvatar.jsx";
import useScrollEdges from "../../ui/useScrollEdges.js";
import ModName from "./ModName.jsx";
import TreeCollapse from "./TreeCollapse.jsx";
import { dataLangOf } from "./data-lang.js";

/* ---------- данные ---------- */

// Значения по умолчанию действуют только для undefined: null их не заменяет.
const DEFAULTS = {
  search: null,
  flatSection: "for-redux",
  sections: [],
  category: "all",
  branches: new Map(),
  openSections: new Set(),
  openShelves: new Set(),
  shelfId: "",
  refine: "",
  groupId: "",
  labelCount: () => 0,
  labelThumb: () => null,
  labelIcon: () => null,
  onToggleSection: () => {},
  onToggleShelf: () => {},
  onGroup: () => {},
};

const MARKS = [
  ["current", "is-current"],
  ["trail", "is-trail"],
  ["empty", "is-empty"],
];

// Части строки, скрытые от диктора.
const MUTED = new Set(["icon", "count", "caret", "avatar", "thumb"]);

// Правила остановки Tab: первое сработавшее даёт ключ строки, иначе — строка раздела.
const TAB_RULES = [
  ({ groupId, partGroup, groupIds }) => groupId && groupId === partGroup && groupIds.has(groupId) && `group:${groupId}`,
  ({ rail, partGroup, groupIds }) => rail && partGroup && groupIds.has(partGroup) && `group:${partGroup}`,
  ({ rail, category, flatSection, shelfId }) => rail && category === flatSection && shelfId && `shelf:${category}/${shelfId}`,
  ({ rail, category, shelfId, refine }) => !rail && refine && `label:${category}/${shelfId}/${refine}`,
  ({ rail, category, shelfId }) => !rail && shelfId && `shelf:${category}/${shelfId}`,
];

// Шаги стрелок: куда сдвигается фокус от строки с номером at среди rows.
const STEPS = new Map([
  ["ArrowDown", (at, rows) => Math.min(at + 1, rows.length - 1)],
  ["ArrowUp", (at) => Math.max(at - 1, 0)],
  ["Home", () => 0],
  ["End", (at, rows) => rows.length - 1],
]);

/* ---------- чистые помощники ---------- */

const given = (value, fallback) => (value === undefined ? fallback : value);

const resolveProps = (props) => ({
  ...props,
  ...Object.fromEntries(Object.entries(DEFAULTS).map(([name, fallback]) => [name, given(props[name], fallback)])),
});

const editorOf = (shelf) => shelf.editor || shelf.id;
const forks = (shelf) => shelf.labels.length > 1;

const rowClass = (kind, marks) =>
  ["catalog-tree-item", kind, ...MARKS.filter(([flag]) => marks[flag]).map(([, name]) => name)].join(" ");

// Атрибуты кнопки строки в порядке разметки: class, tabindex, aria-current, aria-expanded, data-*.
const buttonProps = ({ kind, marks, tabbed, expanded, data, onClick }) => ({
  className: rowClass(kind, marks),
  tabIndex: tabbed ? 0 : -1,
  "aria-current": marks.current ? "page" : undefined,
  "aria-expanded": expanded,
  ...data,
  onClick,
});

const tabKeyOf = (facts) => TAB_RULES.map((rule) => rule(facts)).find(Boolean) || `section:${facts.category}`;

// Строки второй группы: подкатегории по месту в EDITOR_GROUPS, потом редакторы без подкатегории.
const flatRowsOf = (shelves) => {
  const grouped = new Map();
  const loose = [];
  shelves.forEach((shelf) => {
    const id = Editors_editorGroupOf(editorOf(shelf));
    if (id) grouped.set(id, [...(grouped.get(id) || []), shelf]);
    else loose.push(shelf);
  });
  const byEditor = (group) => (a, b) => group.editors.indexOf(editorOf(a)) - group.editors.indexOf(editorOf(b));
  const inGroups = Editors_EDITOR_GROUPS.filter((group) => grouped.has(group.id)).map((group) => {
    const members = grouped.get(group.id).sort(byEditor(group));
    return members.length === 1 ? { kind: "part", shelf: members[0] } : { kind: "group", group, members };
  });
  return [...inGroups, ...loose.map((shelf) => ({ kind: "part", shelf }))];
};

// Сумма счётов членов группы: «значение или 0»; непустая строка превращает сумму в строку.
const totalOf = (members) => members.reduce((sum, member) => sum + (member.count || 0), 0);

// Всё, что колонка знает о «плоском» разделе и выбранной в нём части.
const describeFlat = ({ sections, branches, flatSection, category, shelfId, groupId }) => {
  const source = sections.find((section) => section.id === flatSection);
  const shelves = source ? branches.get(flatSection) ?? [] : [];
  const rows = flatRowsOf(shelves);
  const chosen = shelves.find((shelf) => shelf.id === shelfId);
  const partGroup = category === flatSection ? groupId || Editors_editorGroupOf(chosen ? editorOf(chosen) : shelfId) : "";
  const groupIds = new Set(rows.filter((row) => row.kind === "group").map((row) => row.group.id));
  return { flatSource: source, flatShelves: shelves, flatRows: rows, partGroup, groupIds };
};

/* ---------- части строки ---------- */

function Cell({ name, glyph, children, ...rest }) {
  const className = glyph ? `catalog-tree-${name} is-glyph` : `catalog-tree-${name}`;
  return (
    <span className={className} aria-hidden={MUTED.has(name) ? "true" : undefined} {...rest}>
      {children}
    </span>
  );
}

const cell = (name, content, extra) => (
  <Cell key={name} name={name} {...extra}>
    {content}
  </Cell>
);

// Картинка знака либо значок-запас.
const picture = (src, Icon) =>
  src ? <img alt="" loading="lazy" decoding="async" draggable="false" src={src} /> : Icon ? <Icon /> : null;

const countCell = (value, locale) => (Number.isFinite(value) ? cell("count", value.toLocaleString(locale)) : null);

const iconCell = (Icon) => cell("icon", Icon ? <Icon /> : null);

const avatarCell = ({ src, letter }) =>
  cell(
    "avatar",
    <AccountAvatar account={{ avatarUrl: src, displayName: letter }} />,
    { lang: dataLangOf(letter) },
  );

const childList = (items) => (
  <ul className="catalog-tree-children" role="list">
    {items}
  </ul>
);

const rowOf = (nodeClass, nodeData, button, branch) => (
  <li className={nodeClass} {...nodeData}>
    {button}
    {branch}
  </li>
);

/* ---------- строки дерева ---------- */

function LeafRow({ view, sectionId, shelf, label, drawn, wide, thumb, Icon }) {
  const { words, category, shelfId, refine, tabKey, labelCount, onLabel, closeGroup } = view;
  const amount = labelCount(sectionId, label, shelf.id);
  const attrs = buttonProps({
    kind: "is-leaf",
    marks: { current: category === sectionId && shelfId === shelf.id && refine === label, empty: !amount },
    tabbed: tabKey === `label:${sectionId}/${shelf.id}/${label}`,
    onClick: () => {
      closeGroup();
      onLabel(sectionId, shelf.id, label);
    },
  });
  return rowOf(
    "catalog-tree-node",
    undefined,
    <button type="button" {...attrs}>
      {drawn && cell("thumb", picture(thumb, Icon), { glyph: !wide })}
      {cell("label", words.label(label))}
      {countCell(amount, words.locale)}
    </button>,
  );
}

function LabelList({ view, sectionId, shelf }) {
  const { labelThumb, labelIcon } = view;
  const probes = shelf.labels.map((label) => [labelThumb(label), labelIcon(label)]);
  const wide = probes.some(([thumb]) => thumb);
  const drawn = wide || probes.some(([, icon]) => icon);
  return childList(
    shelf.labels.map((label) => (
      <LeafRow
        key={label}
        view={view}
        sectionId={sectionId}
        shelf={shelf}
        label={label}
        drawn={drawn}
        wide={wide}
        thumb={labelThumb(label)}
        Icon={labelIcon(label)}
      />
    )),
  );
}

function ShelfRow({ view, sectionId, shelf, signs, wide }) {
  const { words, category, shelfId, refine, tabKey, openShelves, onShelf, onToggleShelf, closeGroup } = view;
  const key = `${sectionId}/${shelf.id}`;
  const selected = category === sectionId && shelfId === shelf.id;
  const current = selected && !refine;
  const branch = forks(shelf);
  const open = openShelves.has(key);
  const sign = shelf.avatar ? avatarCell(shelf.avatar) : cell("thumb", picture(shelf.thumb, shelf.icon), { glyph: !wide });
  const name = shelf.redux ? <ModName name={shelf.label} /> : words.label(shelf.label);
  const press = () => {
    closeGroup();
    if (current && branch) onToggleShelf(sectionId, shelf.id);
    else onShelf(sectionId, shelf.id);
  };
  const button = (
    <button
      type="button"
      className={rowClass("is-shelf", { current, trail: selected && !current, empty: !shelf.count })}
      tabIndex={tabKey === `shelf:${key}` ? 0 : -1}
      aria-current={current ? "page" : undefined}
      aria-expanded={branch ? open : undefined}
      data-section={sectionId}
      data-shelf={shelf.id}
      onClick={press}
    >
      {signs && sign}
      {cell("label", name)}
      {countCell(shelf.count, words.locale)}
    </button>
  );
  const tail = branch && (
    <TreeCollapse open={open}>{() => <LabelList view={view} sectionId={sectionId} shelf={shelf} />}</TreeCollapse>
  );
  return rowOf("catalog-tree-node", { "data-shelf": shelf.id }, button, tail);
}

function ShelfList({ view, sectionId, shelves }) {
  const signs = shelves.some((shelf) => shelf.thumb || shelf.icon || shelf.avatar);
  const wide = shelves.some((shelf) => shelf.thumb && !shelf.thumbGlyph);
  return childList(
    shelves.map((shelf) => (
      <ShelfRow key={shelf.id} view={view} sectionId={sectionId} shelf={shelf} signs={signs} wide={wide} />
    )),
  );
}

function SectionRow({ view, section, flat }) {
  const { words, rail, category, shelfId, groupId, tabKey, branches } = view;
  const { openSections, onSection, onToggleSection, closeGroup } = view;
  const { id } = section;
  const selected = category === id;
  const current = selected && !shelfId && !(flat && groupId);
  const branch = !flat && id !== "all" && Boolean(section.hasShelves);
  const attrs = buttonProps({
    kind: "is-section",
    marks: { current, trail: selected && !current && !(flat && rail), empty: section.empty },
    tabbed: tabKey === `section:${id}`,
    expanded: branch && !rail ? openSections.has(id) : undefined,
    data: { "data-section": id },
    onClick: () => {
      closeGroup();
      if (current && branch && !rail) onToggleSection(id);
      else onSection(id);
    },
  });
  const button = (
    <button type="button" {...attrs}>
      {iconCell(section.icon)}
      {cell("label", words.label(section.label))}
      {countCell(section.count, words.locale)}
    </button>
  );
  const tail = branch && (
    <TreeCollapse open={openSections.has(id) && !rail && branches.get(id)?.length > 0}>
      {() => <ShelfList view={view} sectionId={id} shelves={branches.get(id)} />}
    </TreeCollapse>
  );
  return rowOf("catalog-tree-node is-section", { "data-category": id }, button, tail);
}

// Редактор «Для редуксов»: строка первого уровня (is-part) или вложенная в группу (is-shelf).
function EditorRow({ nested, shelf, view }) {
  const { category, closeGroup, flatSection, onShelf, onToggleShelf, openShelves, rail, refine, shelfId, tabKey, words } =
    view;
  const kind = nested ? "is-shelf" : "is-part";
  const key = `${flatSection}/${shelf.id}`;
  const selected = category === flatSection && shelfId === shelf.id;
  const current = selected && !refine;
  const branch = forks(shelf);
  const attrs = buttonProps({
    data: { "data-section": flatSection, "data-shelf": shelf.id },
    expanded: branch && !rail ? openShelves.has(key) : undefined,
    kind,
    marks: { current, empty: !shelf.count, trail: selected && !current },
    onClick: () => {
      if (!nested) closeGroup();
      if (current && branch && !rail) onToggleShelf(flatSection, shelf.id);
      else onShelf(flatSection, shelf.id);
    },
    tabbed: tabKey === `shelf:${key}`,
  });
  const sign = nested ? cell("thumb", picture(null, shelf.icon), { glyph: true }) : iconCell(shelf.icon);
  const button = (
    <button type="button" {...attrs}>
      {sign}
      {cell("label", words.label(shelf.label))}
      {countCell(shelf.count, words.locale)}
    </button>
  );
  return rowOf(`catalog-tree-node ${kind}`, { "data-shelf": shelf.id }, button);
}

// Подкатегория из нескольких редакторов: раскрывается на месте, в рельсе выбирается целиком.
function GroupRow({ view, row }) {
  const { words, rail, category, shelfId, groupId, tabKey, flatSection, flatShelves, openGroup, onGroup, toggleGroup } = view;
  const { group, members } = row;
  const total = totalOf(members);
  const inside = category === flatSection;
  const shown = !rail && openGroup === group.id;
  const face = [...members, ...flatShelves].find((shelf) => shelf.id === group.face) ?? members[0];
  const attrs = buttonProps({
    kind: "is-part is-group",
    marks: {
      current: inside && !shelfId && groupId === group.id,
      trail: inside && members.some((member) => member.id === shelfId),
      empty: total === 0,
    },
    tabbed: tabKey === `group:${group.id}`,
    expanded: rail ? undefined : shown,
    data: { "data-group": group.id },
    onClick: () => {
      if (rail) onGroup(flatSection, group.id);
      else toggleGroup(group.id);
    },
  });
  const button = (
    <button type="button" {...attrs}>
      {iconCell(face?.icon)}
      {cell("label", words.label(group.label))}
      {cell("caret", <Icons_CaretDown />)}
      {countCell(total, words.locale)}
    </button>
  );
  const tail = (
    <TreeCollapse open={shown}>
      {() => childList(members.map((member) => <EditorRow key={member.id} view={view} shelf={member} nested />))}
    </TreeCollapse>
  );
  return rowOf("catalog-tree-node is-part is-group", { "data-group": group.id }, button, tail);
}

/* ---------- клавиатура ---------- */

// Раскрыть или свернуть ветку строки по её data-атрибутам: группа, полка или раздел.
const flipRow = (row, view) => {
  const [group, shelf, section] = ["data-group", "data-shelf", "data-section"].map((name) => row.getAttribute(name));
  if (group) view.toggleGroup(group);
  else if (shelf) view.onToggleShelf(section, shelf);
  else view.onToggleSection(section);
};

// Стрелки влево и вправо: по состоянию aria-expanded строки — переключить, уйти к родителю или войти в ветку.
const SIDE_ACTIONS = new Map([
  ["ArrowLeft", (state) => (state === "true" ? "flip" : "parent")],
  ["ArrowRight", (state) => new Map([["false", "flip"], ["true", "next"]]).get(state)],
]);

// Родитель строки: кнопка объемлющего узла дерева, если он есть.
const parentOf = (row) => {
  const outer = row.closest(".catalog-tree-node")?.parentElement?.closest(".catalog-tree-node");
  return outer ? Array.from(outer.children).find((child) => child.matches(".catalog-tree-item")) : null;
};

function handleTreeKey(event, view) {
  const rows = Array.from(event.currentTarget.querySelectorAll(".catalog-tree-item")).filter(
    (row) => !view.rail || !row.closest(".catalog-tree-collapse"),
  );
  const at = rows.indexOf(document.activeElement);
  if (at < 0) return;
  const focusOn = (target) => {
    event.preventDefault();
    target?.focus();
  };
  const step = STEPS.get(event.key);
  if (step) {
    focusOn(rows[step(at, rows)]);
    return;
  }
  if (view.rail) return;
  const row = rows[at];
  const action = SIDE_ACTIONS.get(event.key)?.(row.getAttribute("aria-expanded"));
  if (action === "flip") {
    event.preventDefault();
    flipRow(row, view);
  } else if (action === "next") {
    focusOn(rows[at + 1]);
  } else if (action === "parent" && parentOf(row)) {
    focusOn(parentOf(row));
  }
}

/* ---------- колонка ---------- */

// Память колонки: раскрытая подкатегория и раскрытость самой колонки, замер краёв прокрутки, автораскрытие.
function useColumn(settings, flat) {
  const [openGroup, setOpenGroup] = Memory_useRememberedState("catalog:open-group", "");
  const [ownOpen, setOwnOpen] = Memory_useRememberedState("catalog-menu:open", true);
  const [scrollRef, edges] = useScrollEdges();
  const seen = useRef("");
  useEffect(() => {
    if (flat.partGroup === seen.current) return;
    seen.current = flat.partGroup;
    if (flat.partGroup) setOpenGroup(flat.partGroup);
  });
  const expanded = settings.open ?? ownOpen;
  const { openSections, onToggleSection } = settings;
  return {
    openGroup,
    setOwnOpen,
    scrollRef,
    edges,
    expanded,
    rail: !expanded,
    closeGroup: () => {
      setOpenGroup("");
    },
    // Не раскрытую подкатегорию раскрываем, сворачивая открытые разделы; раскрытую — просто сворачиваем.
    toggleGroup: (id) => {
      if (openGroup !== id) for (const sectionId of openSections) onToggleSection(sectionId);
      setOpenGroup(openGroup === id ? "" : id);
    },
  };
}

function Bar({ view }) {
  const { expanded, onOpenChange, rail, search, setOwnOpen, words } = view;
  const caption = expanded ? words.collapseNavigator : words.expandNavigator;
  const heading = <span className="catalog-navigator-heading">{words.navigatorHeading}</span>;
  const lead = !rail && search ? search : heading;
  const flip = () => {
    if (onOpenChange) onOpenChange(!expanded);
    else setOwnOpen(!expanded);
  };
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
        <Icons_SidebarSimple aria-hidden="true" />
      </button>
    </div>
  );
}

function Tree({ view }) {
  const { words, sections, category, flatSource, flatRows } = view;
  const regular = sections.filter((section) => section.id !== view.flatSection);
  const flatList = flatSource && (
    <ul className="catalog-tree-list" role="list">
      <SectionRow view={view} section={flatSource} flat />
      {flatRows.map((row) =>
        row.kind === "group" ? (
          <GroupRow key={`group:${row.group.id}`} view={view} row={row} />
        ) : (
          <EditorRow key={`part:${row.shelf.id}`} view={view} shelf={row.shelf} />
        ),
      )}
    </ul>
  );
  return (
    <nav
      className="catalog-tree"
      aria-label={words.categoriesLabel}
      data-selected-category={category}
      onKeyDown={(event) => handleTreeKey(event, view)}
    >
      <ul className="catalog-tree-list" role="list">
        {regular.map((section) => (
          <SectionRow key={section.id} view={view} section={section} />
        ))}
      </ul>
      {flatList}
    </nav>
  );
}

export default function CatalogNavigator(props) {
  const settings = resolveProps(props);
  const flat = describeFlat(settings);
  const column = useColumn(settings, flat);
  const facts = { ...settings, ...flat, ...column };
  const view = { ...facts, tabKey: tabKeyOf(facts) };
  const rootAttrs = {
    className: "catalog-navigator",
    "aria-label": view.words.navigatorLabel,
    "data-open": view.expanded ? "true" : undefined,
    "data-scroll": view.edges || undefined,
  };
  return (
    <aside {...rootAttrs} ref={view.scrollRef}>
      <Bar view={view} />
      <Tree view={view} />
    </aside>
  );
}
