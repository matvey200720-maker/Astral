// Панель «Предметы»: один образец для всех редакторов с вещами.
import { tr, useTr } from "../../../locales/ui.js";
import ListGroup, { ListSwatch } from "../../../components/ui/ListGroup.jsx";
import {
  findItemModels,
  itemCategories,
  itemNeighbours,
  itemRooms,
  liveKeys,
  scopeForRow,
} from "./items-model.js";
import Button from "../../../components/ui/Button.jsx";
import { partTitles, partWords } from "./part-names.js";
import NavRow from "../../../components/ui/NavRow.jsx";
import { trFill } from "../../../locales/tr-fill.js";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { manySelected, rowToggles, selectedKeys } from "./selection-keys.js";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import { itemPartsVersion, subscribeItemParts } from "./item-parts.js";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { THING_WORDS, countedIn } from "../counted-words.js";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import { usePanelHelp } from "../../../components/ui/panel-help.js";
import TextField from "../../../components/ui/TextField.jsx";
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Check,
  Question,
} from "../../../components/ui/icons.jsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  createElement as h,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/* ---------- таблицы ---------- */

const PART_ROWS = 6;
const MULTI_NAMES = 3;
const WIDE_KINDS = ["room", "arena", "kind"];
const ROOM_HOOKS = ["roomOf", "roomLabel", "roomOrder"];
const HOVER_PAIRS = [
  ["onMouseEnter", "onMouseLeave"],
  ["onFocus", "onBlur"],
];
const SECTION_CLASS = "ui-panel fx-section recolor-section items-panel";
const WIDE_LABELS = new Map([
  ["room", "В этой комнате"],
  ["arena", "Во всём зале"],
]);
// Умолчания применяются только вместо undefined; null от родителя остаётся.
const PANEL_DEFAULTS = {
  asset: null,
  removed: null,
  removal: null,
  renderEditor: null,
  entryExtras: null,
  onHover: null,
  partsOf: null,
  onPiece: null,
  partNote: null,
  elementsOf: null,
  onElement: null,
  elementNote: null,
  onToggle: null,
  renderMulti: null,
  removeMany: null,
  flyOnPick: false,
  title: "Предметы",
  hint: "Всё, что стоит в зале, — по группам. Откройте группу или щёлкните предмет в кадре: править можно только его или все такие же.",
};

function settleProps(raw) {
  const out = Object.assign({}, PANEL_DEFAULTS);
  for (const name of Object.keys(raw)) {
    if (raw[name] !== undefined) out[name] = raw[name];
  }
  return out;
}

/* ---------- мелкие функции ---------- */

function countText(count) {
  return trFill("{0} шт.", count);
}

function say(adapter, text) {
  const own = adapter.words;
  return (own && own[text]) || text;
}

function joinDots(...bits) {
  let text = "";
  for (const bit of bits) {
    if (bit) text += text ? ` · ${bit}` : bit;
  }
  return text;
}

function withCount(text, count) {
  if (count > 1) return `${text} (${count})`;
  return text;
}

function removeLabel(tr, adapter) {
  return tr(adapter.words ? "Удалить" : "Удалить из зала");
}

function byId(list, id) {
  for (const entry of list) {
    if (entry.id === id) return entry;
  }
  return null;
}

function hoverHandlers(onHover, keys, removedSet) {
  const out = {};
  if (!onHover) return out;
  const survivors = () => keys.filter((key) => !removedSet.has(key));
  for (const [inName, outName] of HOVER_PAIRS) {
    out[inName] = () => onHover(survivors());
    out[outName] = () => onHover(null);
  }
  return out;
}

function describeRow(adapter, group) {
  const lead = group.keys.length > 1 ? countText(group.keys.length) : tr("один");
  const tail = group.gone ? trFill("убрано {0}", group.gone) : "";
  return joinDots(lead, adapter.originOf(group.model), tail);
}

function countInRoom(adapter, objects, model, room) {
  let total = 0;
  for (const key of model.keys) {
    if (adapter.roomOf(objects.byKey.get(key)) === room) total += 1;
  }
  return total;
}

function namesNote(names) {
  if (names.length <= MULTI_NAMES) return names.join(", ");
  const head = names.slice(0, MULTI_NAMES).join(", ");
  return `${head} ${trFill("и ещё {0}", names.length - MULTI_NAMES)}`;
}

function wideScopesOf(adapter, objects, model, selection, item) {
  const custom = adapter.wideScopes?.(model, selection, item);
  if (custom) return custom;
  if (model.count < 2) return [];
  const rooms = new Set();
  for (const key of model.keys) rooms.add(adapter.roomOf(objects.byKey.get(key)));
  const wide = ["arena"];
  if (rooms.size > 1) wide.unshift("room");
  return wide;
}

function titleReader(adapter) {
  return (entry) => adapter.titleOf(entry);
}

function blankOrigin() {
  return { model: -1, category: "" };
}

function returnTarget(memory, item) {
  const last = memory.current;
  return last.model === item.model ? last.category : "";
}

function locate(objects, selection) {
  const wanted = selection ? selection.key : undefined;
  if (wanted === null || wanted === undefined) return { item: null, model: null };
  const item = objects?.byKey.get(wanted) || null;
  return { item, model: item ? objects.models[item.model] : null };
}

function modeOf(objects, many, browsing, here) {
  if (!objects) return "none";
  if (browsing) return "list";
  if (many) return "multi";
  return here.item && here.model ? "item" : "list";
}

/* ---------- разметка-помощники ---------- */

function pageSection(page, label, extras, children) {
  const tall = page === "item" || page === "many";
  const attrs = { className: tall ? `${SECTION_CLASS} items-page` : SECTION_CLASS };
  attrs["aria-label"] = label;
  attrs["data-arena-section"] = "items";
  attrs["data-items-page"] = page;
  return h("section", Object.assign(attrs, extras), ...children);
}

function ItemsHelp(props) {
  const text = props.text;
  if (usePanelHelp([text])) return null;
  const attrs = { className: "items-help", role: "img", tabIndex: 0, title: text, "aria-label": text };
  return h("span", attrs, h(Question, { "aria-hidden": "true" }));
}

function pagerButtons(tr, [goPrev, goNext], [prevLabel, nextLabel]) {
  const spec = [
    [CaretLeft, prevLabel, goPrev],
    [CaretRight, nextLabel, goNext],
  ];
  const buttons = spec.map(([Glyph, label, onClick]) =>
    h(Button, {
      size: "sm",
      variant: "ghost",
      className: "items-page-icon",
      icon: h(Glyph, { "aria-hidden": "true" }),
      ariaLabel: tr(label),
      title: tr(label),
      onClick,
    }),
  );
  return h("span", { className: "items-page-actions" }, ...buttons);
}

function actionRow(id, label, onClick, danger) {
  const row = { id, label, onClick };
  if (danger) row.danger = true;
  return row;
}

// Свои строки органов правки: обычные, середина, опасные, хвост.
function stackActions(own, middle, tail) {
  const calm = [];
  const risky = [];
  for (const [id, action] of Object.entries(own)) {
    const row = { id, label: action.label, danger: action.danger, onClick: action.run };
    (row.danger ? risky : calm).push(row);
  }
  return [...calm, ...middle, ...risky, ...tail];
}

/* ---------- экспорт: охват, переключатель, действия органов правки ---------- */

export function scopeToggle(scope) {
  return WIDE_KINDS.includes(scope) ? "all" : "one";
}

export function ScopeSwitch(props) {
  const tr = useTr();
  const where = props.where === undefined ? "{0} шт. в зале" : props.where;
  const title = props.title === undefined ? "" : props.title;
  const line = { className: "items-scope-line" };
  line.title = title || undefined;
  line["data-items-scope"] = props.checked ? "all" : "one";
  const inner = h(SwitchLine, {
    label: tr("Все такие"),
    hint: trFill(where, props.count),
    checked: props.checked,
    onChange: props.onChange,
  });
  return h("div", line, inner);
}

export const ItemActionContext = createContext(null);

export function useItemAction(id, action) {
  const register = useContext(ItemActionContext);
  const run = useRef();
  run.current = action?.run;
  const label = (action && action.label) || "";
  const danger = !!(action && action.danger);
  useEffect(() => {
    if (!register) return undefined;
    const entry = label ? { label, danger, run: () => run.current?.() } : null;
    register(id, entry);
    return () => register(id, null);
  }, [register, id, label, danger]);
}

/* ---------- строки нижней карточки от органов правки ---------- */

function ownReducer(current, step) {
  if (step.action) return { ...current, [step.id]: step.action };
  if (!(step.id in current)) return current;
  const next = { ...current };
  delete next[step.id];
  return next;
}

function useOwnRegistry() {
  const [own, dispatch] = useReducer(ownReducer, {});
  const register = useCallback((id, action) => dispatch({ id, action }), []);
  return [own, register];
}

/* ---------- «Из чего» ---------- */

function levelRowProps(kind, row) {
  const attrs = {
    key: row.id,
    icon: h(ListSwatch, { colour: row.colour }),
    title: row.title,
    caption: row.caption,
    onOpen: row.open,
  };
  attrs[`data-items-${kind}`] = row.id;
  return attrs;
}

function expanderRow(tr, open, setOpen, total) {
  const Arrow = open ? CaretUp : CaretDown;
  return h(NavRow, {
    title: open ? tr("Свернуть") : trFill("Все части ({0})", total),
    trailing: h(Arrow, { "aria-hidden": "true" }),
    "aria-expanded": open,
    onOpen: () => setOpen(!open),
  });
}

function LevelRows(props) {
  const tr = useTr();
  const [all, setAll] = useState(false);
  const rows = props.rows;
  const overflow = rows.length > PART_ROWS;
  const limit = all || !overflow ? rows.length : PART_ROWS - 1;
  const lines = [];
  for (let at = 0; at < limit; at += 1) lines.push(h(NavRow, levelRowProps(props.kind, rows[at])));
  if (overflow) lines.push(expanderRow(tr, all, setAll, rows.length));
  return h(ListGroup, { title: tr("Из чего"), "data-items-group": "parts" }, ...lines);
}

function levelRow(id, title, caption, colour, open) {
  return { id, title, caption, colour, open };
}

/* ---------- страница набора ---------- */

// Вещи набора по номерам; пропавшие из описи отбрасываются.
function itemsOfKeys(objects, keys) {
  const items = [];
  for (const key of keys) {
    const found = objects.byKey.get(key);
    if (found) items.push(found);
  }
  return items;
}

function MultiPage(props) {
  const tr = useTr();
  const [own, register] = useOwnRegistry();
  const adapter = props.adapter;
  const items = itemsOfKeys(props.objects, props.keys);
  const keys = items.map((entry) => entry.key);
  const label = countedIn(items.length, THING_WORDS);
  const titles = new Set();
  for (const entry of items) titles.add(adapter.titleOf(props.objects.models[entry.model]));
  const alive = keys.filter((key) => !props.removedSet.has(key));
  const removal = (props.removeMany && props.removeMany(alive)) || null;
  let removeRow = null;
  if (removal?.count) {
    const text = withCount(removeLabel(tr, adapter), removal.count);
    removeRow = actionRow("remove", text, removal.remove, true);
  }
  const body = [
    props.renderMulti({ items, keys }),
    h(ActionRows, { label: tr("Действия"), actions: stackActions(own, [], [removeRow]) }),
  ];
  const section = pageSection("many", label, { "data-items-count": items.length }, body);
  const head = { label, note: namesNote([...titles]) || null, backLabel: tr("Назад"), onBack: props.onBack };
  return h(PanelPage, head, h(ItemActionContext.Provider, { value: register }, section));
}

/* ---------- страница вещи: сводка, что внутри, шапка ---------- */

function wideGoal(adapter, facts, model, selection, item) {
  if (facts.scope === "room" || facts.scope === "arena") return facts.scope;
  const wished = adapter.wideDefault?.(model, selection, item);
  if (wished) return wished;
  const split = facts.wides.includes("room") && facts.inRoom > 1;
  return split ? "room" : facts.wides.at(-1);
}

function pageFacts(props) {
  const adapter = props.adapter, model = props.model, item = props.item;
  const selection = props.selection, removedSet = props.removedSet;
  const facts = { scope: selection.scope || "one" };
  facts.toggle = scopeToggle(facts.scope);
  facts.live = liveKeys(model, removedSet);
  facts.removedHere = removedSet.has(item.key);
  const room = adapter.roomOf(item);
  facts.wides = wideScopesOf(adapter, props.objects, model, selection, item);
  facts.near = itemNeighbours(props.objects, item.key, {
    removed: removedSet,
    room: facts.scope === "room" ? room : null,
    roomOf: adapter.roomOf,
  });
  facts.titleText = adapter.itemTitle ? adapter.itemTitle(model, item) : adapter.titleOf(model);
  facts.deletion = props.removal
    ? props.removal({ item, model, scope: facts.scope, live: facts.live, gone: facts.removedHere })
    : null;
  facts.gone = facts.deletion?.gone ?? facts.removedHere;
  facts.inRoom = countInRoom(adapter, props.objects, model, room);
  facts.wideTarget = wideGoal(adapter, facts, model, selection, item);
  facts.allCount = facts.wideTarget === "room" ? facts.inRoom : model.count;
  const flagged = Boolean(adapter.wideOnly?.(model));
  facts.wideOnly = flagged && facts.wides.length > 0;
  return facts;
}

function allHintOf(props, facts) {
  const custom = props.adapter.allHint?.(props.model, props.selection, { inRoom: facts.inRoom });
  if (custom) return custom;
  if (facts.wideTarget === "room") {
    return trFill(
      "Все предметы этой модели в этой комнате ({0}): правка уходит на все сразу.",
      facts.inRoom,
    );
  }
  return trFill(
    "Все предметы этой модели ({0}) во всём зале: правка уходит на все сразу.",
    props.model.count,
  );
}

// Что взято внутри вещи: лист (материал) или часть.
function digInto(props) {
  const key = props.item.key;
  const selection = props.selection;
  const elements = (props.onElement && props.elementsOf?.(key)) || [];
  const split = elements.length > 1;
  let elementAt = -1;
  if (split && selection.material) {
    elementAt = elements.findIndex((entry) => entry.texture === selection.material);
  }
  const element = elements[elementAt] ?? null;
  let pieceAt = null;
  if (!split && Number.isInteger(selection.piece)) pieceAt = selection.piece;
  const piece = pieceAt === null ? null : props.parts?.[pieceAt] || null;
  return { elements, split, elementAt, element, pieceAt, piece };
}

function makeLevel(name, index, total, go, up) {
  return { name, index, total, go, up };
}

function levelFrom(props, dig, pieceName) {
  const key = props.item.key;
  if (dig.element) {
    const list = dig.elements;
    return makeLevel(
      dig.element.label,
      dig.elementAt,
      list.length,
      (at) => props.onElement(key, list[at].texture),
      () => props.onElement(key, null),
    );
  }
  if (!dig.piece) return null;
  return makeLevel(
    pieceName,
    dig.pieceAt,
    props.parts?.length || 0,
    (at) => props.onPiece(key, at),
    () => props.onPiece(key, null),
  );
}

function nameOfPiece(dig, partNames) {
  if (!dig.piece) return "";
  return partNames[dig.pieceAt] || dig.piece.label;
}

function useDrill(props) {
  const dig = digInto(props);
  const asset = props.asset, parts = props.parts;
  const words = useMemo(() => partWords(asset, parts), [asset, parts]);
  const partNames = partTitles(words);
  const pieceName = nameOfPiece(dig, partNames);
  const part = dig.piece?.box ? { box: dig.piece.box, label: pieceName } : null;
  const level = levelFrom(props, dig, pieceName);
  return Object.assign(dig, { words, partNames, pieceName, part, level });
}

function levelRowsFor(props, dig) {
  if (dig.level) return [];
  const key = props.item.key;
  if (dig.split) {
    return dig.elements.map((entry) =>
      levelRow(
        entry.texture,
        entry.label,
        props.elementNote?.(key, entry.texture) || null,
        entry.colour || null,
        () => props.onElement(key, entry.texture),
      ),
    );
  }
  const parts = props.parts || [];
  if (parts.length < 2 || !props.onPiece) return [];
  return parts.map((entry) =>
    levelRow(
      entry.index,
      dig.partNames[entry.index] || entry.label,
      props.partNote?.(key, entry) || null,
      dig.words[entry.index]?.colour || null,
      () => props.onPiece(key, entry.index),
    ),
  );
}

function pagerFor(tr, level, stepping, near, step) {
  if (level) {
    if (level.total < 2) return null;
    const turn = (shift) => () => level.go((level.index + shift + level.total) % level.total);
    return pagerButtons(tr, [turn(-1), turn(1)], ["Предыдущая часть", "Следующая часть"]);
  }
  if (!stepping) return null;
  const goTo = [near.prev, near.next].map((key) => () => step(key));
  return pagerButtons(tr, goTo, ["Предыдущий", "Следующий"]);
}

function headingFor(tr, props, facts, level, note) {
  if (!level) {
    return {
      label: facts.titleText,
      note: note || null,
      backLabel: tr(props.backLabel),
      onBack: props.onBack,
    };
  }
  const title = facts.titleText;
  return Object.assign({ label: level.name }, { note: title, backLabel: title, onBack: level.up });
}

function goneRow(tr, adapter) {
  const copy = tr(say(adapter, "Предмет убран из зала: в игре его не будет."));
  const dot = h("span", { className: "items-status-dot", "aria-hidden": "true" });
  const words = h("span", { className: "items-status-copy" }, h("b", null, tr("Убран")), h("small", null, copy));
  return h("div", { className: "items-status-row", "data-items-status": "gone", title: copy }, dot, words);
}

function scopeBlockFor(tr, props, facts) {
  const adapter = props.adapter, model = props.model;
  const all = facts.toggle === "all";
  let count = facts.allCount;
  if (all) count = facts.scope === "room" ? facts.inRoom : model.count;
  let where = say(adapter, "{0} шт. в зале");
  if ((all ? facts.scope : facts.wideTarget) === "room") where = "{0} шт. в этой комнате";
  const children = [];
  if (!facts.wideOnly) {
    children.push(
      h(ScopeSwitch, {
        checked: all,
        count,
        where,
        title: allHintOf(props, facts),
        onChange: (on) => props.onScope(on ? facts.wideTarget : "one"),
      }),
    );
  }
  if ((all || facts.wideOnly) && facts.wides.length > 1) {
    children.push(
      h(SegmentedControl, {
        label: tr("Где «все такие»"),
        size: "sm",
        className: "items-scope items-scope-wide",
        options: facts.wides.map((value) => ({ value, label: tr(WIDE_LABELS.get(value)) })),
        value: facts.scope,
        onChange: props.onScope,
      }),
    );
  }
  return h("div", { className: "items-scope-block" }, ...children);
}

function deletionRows(tr, adapter, deletion, removable) {
  if (!deletion) return { restore: null, remove: null };
  const back = tr(adapter.words ? "Вернуть на место" : "Вернуть в зал");
  const restoreLabel = withCount(back, deletion.restoreCount || 0);
  const removeText = withCount(removeLabel(tr, adapter), deletion.removeCount || 0);
  return {
    restore: deletion.canRestore ? actionRow("restore", restoreLabel, deletion.restore, false) : null,
    remove: deletion.canRemove && removable ? actionRow("remove", removeText, deletion.remove, true) : null,
  };
}

function editorNode(props, facts, dig) {
  if (!props.renderEditor) return undefined;
  const args = { selection: props.selection, scope: facts.scope };
  args.item = props.item;
  args.model = props.model;
  args.live = facts.live;
  args.part = dig.part;
  args.element = dig.element && { texture: dig.element.texture, label: dig.element.label };
  return props.renderEditor(args);
}

function itemBody(tr, props, facts, dig, rows, actions) {
  const gone = facts.gone;
  const slots = [];
  if (!gone && facts.wides.length > 0 && props.adapter.scopes !== false) {
    slots.push(scopeBlockFor(tr, props, facts));
  }
  slots.push(gone ? goneRow(tr, props.adapter) : editorNode(props, facts, dig));
  if (!gone && rows.length > 1) {
    slots.push(h(LevelRows, { rows, kind: dig.split ? "element" : "part" }));
  }
  slots.push(h(ActionRows, { label: tr("Действия с предметом"), actions }));
  return slots;
}

function ItemPage(props) {
  const tr = useTr();
  const facts = pageFacts(props);
  const onScope = props.onScope;
  const wideOnly = facts.wideOnly, toggle = facts.toggle, wideTarget = facts.wideTarget;

  useEffect(() => {
    if (!(wideOnly && toggle === "one")) return;
    onScope(wideTarget);
  }, [wideOnly, toggle, wideTarget, onScope]);

  const [own, register] = useOwnRegistry();
  const gone = facts.gone;
  const dig = useDrill(props);
  const level = dig.level;
  const rows = levelRowsFor(props, dig);
  const deleting = deletionRows(tr, props.adapter, facts.deletion, !level && !own.swap);
  const actions = stackActions(gone ? {} : own, [deleting.restore], [deleting.remove]);

  const near = facts.near;
  const stepping = toggle === "one" && !level && Boolean(near);
  function stepTo(key) {
    props.onSelect(key, "one");
    if (props.onFind) props.onFind(key);
  }
  const crumbs = [];
  if (props.category) crumbs.push(tr(props.category.label));
  if (stepping) crumbs.push(trFill("{0} из {1}", near.index, near.total));
  const heading = headingFor(tr, props, facts, level, joinDots(...crumbs));

  const body = itemBody(tr, props, facts, dig, rows, actions);
  const extras = { "data-arena-item": props.item.key };
  if (dig.piece) extras["data-items-piece"] = dig.pieceAt;
  if (dig.element) extras["data-items-element"] = dig.element.texture;
  if (gone) extras["data-items-gone"] = "";
  const section = pageSection("item", heading.label, extras, body);
  return h(
    PanelPage,
    Object.assign({}, heading, { actions: pagerFor(tr, level, stepping, near, stepTo) }),
    h(ItemActionContext.Provider, { value: register }, section),
  );
}

/* ---------- состояние панели ---------- */

function useBrowsing(selection) {
  const [browsing, setBrowsing] = useState(false);
  const toggled = useRef(null);
  useEffect(() => {
    if (toggled.current) {
      toggled.current = null;
      return;
    }
    setBrowsing(false);
  }, [selection]);
  return { browsing, setBrowsing, toggled };
}

function useHoverReset(onHover, pageKey) {
  useEffect(() => {
    if (onHover) onHover(null);
    // onHover — сообщение наружу, а не зависимость страницы
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);
}

/* ---------- список: выбор строк ---------- */

function aliveOf(env, keys) {
  return keys.filter((key) => !env.removedSet.has(key));
}

function isChosen(env, keys) {
  const alive = aliveOf(env, keys);
  return alive.length > 0 && alive.every((key) => env.chosen.has(key));
}

function chooseRow(env, group, from) {
  Object.assign(env.cameFrom.current, { category: from, model: group.model.index });
  const alive = aliveOf(env, group.keys);
  const key = alive.length > 0 ? alive[0] : group.keys[0];
  env.onSelect(key, scopeForRow(group));
  if (env.flyOnPick && env.onFind) env.onFind(key);
}

function chooseModel(env, entry, from) {
  chooseRow(env, { model: entry, keys: entry.keys }, from);
}

function toggleKeys(env, keys) {
  Object.assign(env.toggled, { current: true });
  env.setBrowsing(true);
  for (const key of rowToggles(env.selection, aliveOf(env, keys))) env.onToggle(key);
}

const CLICK_MODES = {
  toggle: (env, keys) => toggleKeys(env, keys),
  pick: (env, keys, pick) => pick(),
};

function clickHandler(env, keys, pick) {
  return (event) => {
    const mode = event?.shiftKey && env.onToggle ? "toggle" : "pick";
    return CLICK_MODES[mode](env, keys, pick);
  };
}

function rowNode(env, key, model, keys, caption, pick) {
  const on = isChosen(env, keys);
  const attrs = {
    key,
    className: `items-row${on ? " is-selected" : ""}`,
    "aria-pressed": on,
    title: env.adapter.titleOf(model),
    tooltip: model.name,
    caption,
    onOpen: clickHandler(env, keys, pick),
  };
  if (on) attrs.trailing = h(Check, { "aria-hidden": "true" });
  return h(NavRow, Object.assign(attrs, hoverHandlers(env.onHover, keys, env.removedSet)));
}

function pickedGroup(env) {
  if (!env.many) return null;
  const tr = env.tr;
  const row = h(NavRow, {
    title: countedIn(env.selection.keys.length, THING_WORDS),
    caption: tr("Выбрано"),
    onOpen: () => env.setBrowsing(false),
    "data-items-picked": "",
  });
  return h(ListGroup, { "data-items-group": "picked" }, row);
}

/* ---------- список: категория ---------- */

function roomBlock(env, shown, room) {
  const lines = [];
  for (const group of room.groups) {
    const caption = describeRow(env.adapter, group);
    lines.push(
      rowNode(env, group.model.index, group.model, group.keys, caption, () =>
        chooseRow(env, group, shown.id),
      ),
    );
  }
  const title = h(
    "h4",
    { className: "items-room-title" },
    h("span", null, room.label),
    h("small", null, countText(room.count)),
  );
  const list = h(ListGroup, { label: room.label, className: "items-rows" }, ...lines);
  return h("div", { key: room.id, className: "items-room", "data-items-room": room.id }, title, list);
}

function categoryPage(env, shown) {
  const tr = env.tr, adapter = env.adapter;
  const options = { removed: env.removedSet };
  for (const name of ROOM_HOOKS) options[name] = adapter[name];
  const blocks = itemRooms(env.objects, shown.models, options).map((room) =>
    roomBlock(env, shown, room),
  );
  const section = pageSection("category", tr(shown.label), { "data-items-category": shown.id }, [
    pickedGroup(env),
    ...blocks,
  ]);
  return h(
    PanelPage,
    {
      label: tr(shown.label),
      note: trFill(say(adapter, "{0} шт. в зале"), shown.total),
      backLabel: tr(env.title),
      onBack: () => env.setCategory(""),
    },
    section,
  );
}

/* ---------- список: вход ---------- */

function categoryNavRow(env, entry) {
  const tr = env.tr;
  const attrs = {
    key: entry.id,
    className: "items-category",
    title: tr(entry.label),
    caption: joinDots(countText(entry.total), entry.gone ? trFill("убрано {0}", entry.gone) : ""),
    onOpen: () => {
      env.setCategory(entry.id);
      env.setQuery("");
    },
  };
  const everyKey = entry.models.flatMap((model) => model.keys);
  Object.assign(attrs, hoverHandlers(env.onHover, everyKey, env.removedSet));
  attrs["data-items-category"] = entry.id;
  return h(NavRow, attrs);
}

function entryStage(query, found) {
  if (!query.trim()) return "groups";
  return found.length > 0 ? "found" : "empty";
}

function foundNode(env, entry) {
  let removedCount = 0;
  for (const key of entry.keys) if (env.removedSet.has(key)) removedCount += 1;
  const caption = describeRow(env.adapter, { model: entry, keys: entry.keys, gone: removedCount });
  return rowNode(env, entry.index, entry, entry.keys, caption, () => chooseModel(env, entry, ""));
}

const ENTRY_BODIES = {
  groups(env) {
    const tr = env.tr;
    const rows = env.categories.map((entry) => categoryNavRow(env, entry));
    const attrs = { className: "items-groups", role: "group", "aria-label": tr("Группы предметов") };
    return h("div", attrs, h(ListGroup, null, ...rows));
  },
  found(env, found) {
    const tr = env.tr;
    const lines = [];
    for (const entry of found) lines.push(foundNode(env, entry));
    return h(ListGroup, { label: tr("Найденное"), className: "items-rows" }, ...lines);
  },
  empty(env) {
    const tr = env.tr;
    return h("p", { className: "fx-hint" }, tr("Ничего не нашлось."));
  },
};

function entryPage(env) {
  const tr = env.tr;
  const found = findItemModels(env.categories, env.query, { titleOf: titleReader(env.adapter) });
  const totals = trFill("Всего предметов: {0}, моделей: {1}.", env.objects.total, env.objects.models.length);
  const search = h(TextField, {
    label: "",
    "aria-label": tr("Найти предмет"),
    value: env.query,
    placeholder: tr("Найти предмет"),
    onChange: env.setQuery,
  });
  const stage = entryStage(env.query, found);
  return pageSection("entry", tr(env.title), {}, [
    h(ItemsHelp, { text: `${tr(env.hint)} ${totals}` }),
    pickedGroup(env),
    search,
    ENTRY_BODIES[stage](env, found),
    env.entryExtras,
  ]);
}

/* ---------- панель ---------- */

function ItemsPanel(rawProps) {
  const props = settleProps(rawProps);
  const adapter = props.adapter, objects = props.objects, selection = props.selection;
  const removed = props.removed;
  const tr = useTr();
  useSyncExternalStore(subscribeItemParts, itemPartsVersion);
  const removedSet = useMemo(() => new Set(removed ? removed : []), [removed]);
  const categories = useMemo(
    () => {
      const options = { removed: removedSet };
      options.categories = adapter.categories;
      options.categoryOf = adapter.categoryOf;
      return itemCategories(objects, options);
    },
    [objects, adapter, removedSet],
  );
  const [category, setCategory] = useState("");
  const here = locate(objects, selection);
  const many = manySelected(selection) ? Boolean(props.renderMulti) : false;
  const [query, setQuery] = useState("");
  const cameFrom = useRef(blankOrigin());
  const { browsing, setBrowsing, toggled } = useBrowsing(selection);
  const chosen = selectedKeys(selection).reduce((set, key) => set.add(key), new Set());
  const shown = byId(categories, category);

  useEffect(() => {
    for (const reset of [setCategory, setQuery]) reset("");
  }, [objects]);
  useEffect(() => {
    if (category && byId(categories, category) === null) setCategory("");
  }, [categories, category]);
  useHoverReset(props.onHover, [category, selection?.key ?? "", query ? "q" : ""].join("|"));

  switch (modeOf(objects, many, browsing, here)) {
    case "none":
      return null;
    case "multi":
      return h(
        MultiPage,
        Object.assign({}, props, {
          keys: selection.keys,
          removedSet,
          onBack: () => props.onSelect(null),
        }),
      );
    case "item": {
      const item = here.item;
      const origin = byId(categories, returnTarget(cameFrom, item));
      return h(
        ItemPage,
        Object.assign({}, props, {
          item,
          model: here.model,
          removedSet,
          category: byId(categories, adapter.categoryOf(here.model)),
          onBack: () => {
            setCategory(returnTarget(cameFrom, item));
            props.onSelect(null);
          },
          backLabel: origin ? origin.label : props.title,
          parts: props.partsOf?.(item.key) || null,
        }),
      );
    }
    default: {
      const env = Object.assign(
        {},
        props,
        { tr, chosen, many, query },
        { categories, removedSet, cameFrom },
        { toggled, setBrowsing, setCategory, setQuery },
      );
      return shown ? categoryPage(env, shown) : entryPage(env);
    }
  }
}

export default ItemsPanel;
