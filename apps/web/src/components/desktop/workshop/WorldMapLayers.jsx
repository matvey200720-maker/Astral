import {
  Fragment,
  createElement as el,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { lowerFor, mapText } from "./world-map/map-copy.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import {
  GLYPH_BOX,
  LAYER_SECTION,
  glyphPath,
  normalizeWorldMap,
  patchMapGroup,
  setMapGroupLocked,
  setMapGroupVisible,
} from "@modovik/vector-map";
import { useMapMemory } from "./world-map-memory.js";
import { buildLayerRows } from "./world-map-layers.js";
import { patchObject } from "./world-map-editing.js";
import VirtualList from "../../ui/VirtualList.jsx";
import {
  BoundingBox,
  CaretDown,
  CaretRight,
  Circle,
  Eye,
  EyeSlash,
  ImageSquare,
  Lock,
  LockOpen,
  MagnifyingGlass,
  MapPinSimple,
  PaintBrush,
  Polygon,
  Stack,
  TextAa,
  TextT,
  X,
} from "../../ui/icons.jsx";

const LIMITS = {
  rowHeight: 32,
  dock: { min: 112, max: 560, fallback: 200 },
  dragStart: 5,
  edgeBand: 28,
  edgeStep: 12,
  savedKeys: 400,
};
const STORE_KEYS = {
  open: "astral.worldMap.layers.open",
  height: "astral.worldMap.layers.height",
};
const PRESS_EVENTS = ["pointermove", "pointerup", "pointercancel"];

const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);
const nothing = () => {};

// Память браузера может быть закрыта: чтение тогда пусто, запись молча теряется.
const browserStore = {
  read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // запись потеряна
    }
  },
};

function clampDock(px) {
  const { min, max } = LIMITS.dock;
  if (px < min) return min;
  return px > max ? max : px;
}

// Проверки значений из памяти редактора; undefined значит «взять запасное».
const ACCEPT = {
  flag: (stored) => (typeof stored === "boolean" ? stored : undefined),
  keys: (stored) =>
    Array.isArray(stored)
      ? stored.filter((k) => typeof k === "string").slice(0, LIMITS.savedKeys)
      : undefined,
};

// ---- что нажатие делает с проектом ----

function rewriteItems(config, section, change) {
  const part = config[section];
  const items = (part?.items ?? []).map(change);
  return normalizeWorldMap({ ...config, [section]: { ...part, items } });
}

function showSection(config, row, visible) {
  if (row.section === "emblems") {
    return rewriteItems(config, "emblems", (it) => Object.assign({}, it, { enabled: visible }));
  }
  const part = Object.assign({}, config[row.section], { enabled: visible });
  return normalizeWorldMap({ ...config, [row.section]: part });
}

function showCategory(config, row, visible) {
  const members = new Set(row.ids);
  return rewriteItems(config, "markers", (it) =>
    members.has(it.id) ? Object.assign({}, it, { enabled: visible }) : it,
  );
}

// ---- виды строк: одна таблица вместо цепочек по типу ----

const FOLDING = {
  folds: true,
  selectable: false,
  draggable: false,
  caretIcon: false,
  caretInName: false,
  caretButton: false,
  lockable: () => false,
  renamable: () => false,
  press: nothing,
  double: nothing,
  menu: null,
  label: null,
  lock: null,
};

const KINDS = {
  section: {
    ...FOLDING,
    caretIcon: true,
    caretInName: true,
    press: (env, row) => env.fold(row.key),
    show: showSection,
  },
  category: {
    ...FOLDING,
    caretButton: true,
    press: (env, row) => env.fold(row.key),
    show: showCategory,
  },
  group: {
    ...FOLDING,
    caretButton: true,
    draggable: true,
    lockable: (row) => !row.user,
    renamable: (row) => row.user,
    press: (env, row, additive) =>
      env.onPickGroup ? env.onPickGroup(row, { additive }) : env.fold(row.key),
    double: (env, row) => (row.user ? env.startRename(row.key) : env.fold(row.key)),
    show: (config, row, visible) => setMapGroupVisible(config, row.section, row.group, visible),
    label: (config, row) => patchMapGroup(config, row.section, row.group, { label: !row.labelOn }),
    lock: (config, row, on) => setMapGroupLocked(config, row.section, row.group, on),
  },
  item: {
    ...FOLDING,
    folds: false,
    selectable: true,
    draggable: true,
    caretInName: true,
    lockable: () => true,
    renamable: (row) => row.renamable,
    press: (env, row, additive) => env.onPick(row.target, { additive }),
    double: (env, row) => {
      if (row.renamable) env.startRename(row.key);
    },
    menu: (env, row, event) => {
      event.preventDefault();
      env.onMenu(row.target, event.clientX, event.clientY);
    },
    show: (config, row, visible) => patchObject(config, row.target, { enabled: visible }),
    label: (config, row) => patchObject(config, row.target, { label: !row.labelOn }),
    lock: (config, row, on) => patchObject(config, row.target, { locked: on }),
  },
};
// строка неизвестного типа: рисуется, но на щелчки не отвечает, а глаз правит раздел
const BLANK_KIND = { ...FOLDING, folds: false, caretInName: true, show: showSection };
const kindOf = (row) => lookup(KINDS, row.type) ?? BLANK_KIND;

// ---- значок строки ----

const ICONS = {
  emblems: [TextAa, "bold"],
  markers: [MapPinSimple, "bold"],
  zones: [Polygon, "bold"],
  paint: [PaintBrush, "bold"],
  set: [Stack, "bold"],
  group: [BoundingBox, "bold"],
  stroke: [PaintBrush, "bold"],
  text: [TextT, "bold"],
  label: [TextT, "bold"],
  image: [ImageSquare, "bold"],
  zone: [Polygon, "bold"],
  dot: [Circle, "fill"],
};

function rowIcon(name) {
  const named = typeof name === "string";
  const known = named ? lookup(ICONS, name) : undefined;
  if (known) return el(known[0], { weight: known[1] });
  if (named && name.startsWith("glyph:")) {
    const outline = glyphPath(name.slice(6));
    if (outline) {
      const box = `0 0 ${GLYPH_BOX} ${GLYPH_BOX}`;
      return el("svg", { viewBox: box }, el("path", { d: outline, fill: "currentColor" }));
    }
    return el(Circle, { weight: "fill" });
  }
  return el(Circle, { weight: "bold" });
}

const foldArrow = (row) => el(row.open ? CaretDown : CaretRight, { "aria-hidden": "true" });

function iconBox(row) {
  const style = row.tint ? { color: row.tint } : undefined;
  const attrs = { className: "wmc-layer-icon", style, "aria-hidden": "true" };
  return el("span", attrs, rowIcon(row.icon));
}

function rowClasses(row, env) {
  const flags = [
    [row.selected, "is-selected"],
    [row.dim, "is-dim"],
    [row.locked || row.inheritedLock, "is-locked"],
    [env.dragKey === row.key, "is-dragging"],
    [env.intoKey === row.key, "is-drop-into"],
  ];
  const on = flags.flatMap(([cond, name]) => (cond ? [name] : []));
  return ["wmc-layer", `is-${row.type}`, ...on].join(" ");
}

function countLabel(row) {
  if (row.of == null) return row.count;
  return mapText("{count} из {total}", { count: row.count, total: row.of });
}

// ---- перетаскивание строк: автомат «нажата → тянется» и редьюсер подсветки ----

const IDLE_DRAG = { key: null, spot: null };
const DRAG_STEPS = {
  start: (s, a) => (s.key === a.key ? s : { ...s, key: a.key }),
  aim: (s, a) => (s.spot === a.spot ? s : { ...s, spot: a.spot }),
  stop: (s) => (s.key === null && s.spot === null ? s : IDLE_DRAG),
};
const dragReducer = (state, action) => DRAG_STEPS[action.type](state, action);

// Что можно сделать, бросив строку на другую: вернуть место или null.
const AIM_RULES = {
  group: (dragged, over, place) =>
    over.type === "group" && over.section === dragged.section ? place : null,
  item: (dragged, over, place) => {
    const home = LAYER_SECTION[dragged.target.kind];
    if (over.type === "item") return LAYER_SECTION[over.target.kind] === home ? place : null;
    return over.type === "group" && over.section === home ? "into" : null;
  },
};

function aimDrop(rows, dragged, y) {
  const height = LIMITS.rowHeight;
  const index = Math.floor(y / height);
  const over = rows[index];
  if (!over || over.key === dragged.key) return null;
  const upper = y - index * height < height / 2;
  const place = AIM_RULES[dragged.type](dragged, over, upper ? "before" : "after");
  return place && { index, key: over.key, place };
}

const REORDER_ARGS = {
  group: (dragged, { row: over, place }) => [
    { type: "group", section: dragged.section, group: dragged.group },
    { type: "group", section: over.section, group: over.group, place },
  ],
  item: (dragged, { row: over, place }) => [
    { type: "item", target: dragged.target },
    over.type === "item"
      ? { type: "item", target: over.target, place }
      : { type: "group", section: over.section, group: over.group, place },
  ],
};

const GESTURE = {
  "armed:pointermove": (g, e, ops) => {
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < LIMITS.dragStart) return;
    g.phase = "live";
    ops.start();
    ops.reaim(e);
  },
  "armed:pointerup": (g, e, ops) => ops.release(),
  "armed:pointercancel": (g, e, ops) => ops.release(),
  "live:pointermove": (g, e, ops) => ops.reaim(e),
  "live:pointerup": (g, e, ops) => {
    if (ops.release() && g.aim && ops.mounted()) ops.drop();
  },
  "live:pointercancel": (g, e, ops) => ops.release(),
  "live:keydown": (g, e, ops) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    ops.release();
  },
};

function useRowDrag({ rows, onReorder, blocked, scrollRef }) {
  const [view, dispatch] = useReducer(dragReducer, IDLE_DRAG);
  const swallow = useRef(false);
  const latest = useRef({ rows, onReorder });

  useEffect(() => {
    latest.current = { rows, onReorder };
  });

  const begin = (event, row) => {
    if (event.button !== 0 || !onReorder || blocked || !kindOf(row).draggable) return;
    const g = { row, phase: "armed", x: event.clientX, y: event.clientY, aim: null };
    const ops = {};
    const listener = (e) => {
      const step = lookup(GESTURE, `${g.phase}:${e.type}`);
      if (step) step(g, e, ops);
    };
    ops.start = () => dispatch({ type: "start", key: row.key });
    ops.mounted = () => Boolean(scrollRef.current);
    ops.release = () => {
      PRESS_EVENTS.forEach((name) => window.removeEventListener(name, listener));
      window.removeEventListener("keydown", listener, true);
      if (g.phase !== "live") return false;
      swallow.current = true;
      dispatch({ type: "stop" });
      return true;
    };
    ops.reaim = (e) => {
      const area = scrollRef.current;
      if (!area) {
        g.aim = null;
        dispatch({ type: "aim", spot: null });
        return;
      }
      const box = area.getBoundingClientRect();
      const { edgeBand, edgeStep } = LIMITS;
      if (box.height > edgeBand * 2) {
        if (e.clientY < box.top + edgeBand) area.scrollTop -= edgeStep;
        else if (e.clientY > box.bottom - edgeBand) area.scrollTop += edgeStep;
      }
      const list = latest.current.rows;
      const found = aimDrop(list, row, e.clientY - box.top + area.scrollTop);
      g.aim = found && { row: list[found.index], place: found.place };
      dispatch({ type: "aim", spot: found });
    };
    ops.drop = () => latest.current.onReorder(...REORDER_ARGS[row.type](row, g.aim));

    PRESS_EVENTS.forEach((name) => window.addEventListener(name, listener));
    window.addEventListener("keydown", listener, true);
  };

  // щелчок, которым закончилось перетаскивание, проглатывается один раз
  const absorbClick = () => {
    const had = swallow.current;
    swallow.current = false;
    return had;
  };

  return { view, begin, absorbClick };
}

// ---- ручка высоты ----

function beginResize(event, startHeight, setHeight) {
  if (event.button !== 0) return;
  event.preventDefault();
  const grip = event.currentTarget;
  if (typeof grip.setPointerCapture === "function") grip.setPointerCapture(event.pointerId);
  const fromY = event.clientY;
  let last = startHeight;
  const handlers = {};
  const finish = () => {
    Object.entries(handlers).forEach(([name, fn]) => grip.removeEventListener(name, fn));
    browserStore.write(STORE_KEYS.height, String(last));
  };
  handlers.pointermove = (e) => {
    last = clampDock(startHeight + (fromY - e.clientY));
    setHeight(last);
  };
  handlers.pointerup = finish;
  handlers.pointercancel = finish;
  Object.entries(handlers).forEach(([name, fn]) => grip.addEventListener(name, fn));
}

function useDockPrefs() {
  const [expanded, setExpanded] = useState(() => browserStore.read(STORE_KEYS.open) !== "0");
  const [height, setHeight] = useState(() => {
    const saved = Number(browserStore.read(STORE_KEYS.height));
    return saved ? clampDock(Math.round(saved)) : LIMITS.dock.fallback;
  });
  return { expanded, setExpanded, height, setHeight };
}

// ---- части панели ----

function RenameField({ row, finish }) {
  const keys = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(row, e.currentTarget.value);
    else if (e.key === "Escape") finish(row, null);
  };
  return el("input", {
    className: "wmc-layer-rename",
    "aria-label": mapText("Новое имя для «{title}»", { title: row.title }),
    defaultValue: row.title,
    ref: focusAndSelect,
    onKeyDown: keys,
    onBlur: (e) => finish(row, e.currentTarget.value),
  });
}

function focusAndSelect(input) {
  if (!input) return;
  input.focus();
  input.select();
}

function toggleButton(variant, attrs, glyph) {
  const base = { type: "button", className: `wmc-layer-toggle ${variant}`, tabIndex: -1 };
  return el("button", { ...base, ...attrs }, glyph);
}

function rowToggles(row, kind, env) {
  const said = (key) => mapText(key, { title: row.title });
  const pinned = Boolean(row.locked || row.inheritedLock);
  const byParent = Boolean(row.inheritedLock && !row.locked);
  let lockHint = "Закрепить: на карте не выделяется и не двигается";
  if (row.locked) lockHint = "Открепить";
  if (byParent) lockHint = "Закреплён весь набор";

  const out = [];
  if (row.labelOn !== undefined) {
    const labelWording = row.labelOn ? "Скрыть подпись «{title}»" : "Показать подпись «{title}»";
    out.push(
      toggleButton(
        "is-text",
        {
          "aria-pressed": row.labelOn,
          "aria-label": said(labelWording),
          title: tr(row.labelOn ? "Скрыть подпись, оставив значок или круг" : "Показать подпись"),
          onClick: () => env.act.label(row),
        },
        el(TextAa),
      ),
    );
  }
  if (kind.lockable(row)) {
    out.push(
      toggleButton(
        "is-lock",
        {
          disabled: byParent,
          "aria-pressed": pinned,
          "aria-label": said(pinned ? "Открепить «{title}»" : "Закрепить «{title}»"),
          title: tr(lockHint),
          onClick: () => env.act.lock(row),
        },
        el(pinned ? Lock : LockOpen),
      ),
    );
  }
  out.push(
    toggleButton(
      "is-eye",
      {
        "aria-pressed": !row.visible,
        "aria-label": said(row.visible ? "Скрыть «{title}»" : "Показать «{title}»"),
        title: tr(row.visible ? "Скрыть" : "Показать"),
        onClick: () => env.act.eye(row),
      },
      el(row.visible ? Eye : EyeSlash),
    ),
  );
  return out;
}

function nameButton(row, kind, env) {
  const caretAttrs = { className: "wmc-layer-caret", "aria-hidden": "true" };
  const caret = kind.caretInName && el("span", caretAttrs, kind.caretIcon ? foldArrow(row) : null);
  const titleAttrs = { className: "wmc-layer-title", "data-audit-ignore": "caps" };
  const title = el("span", titleAttrs, row.title);
  const count = row.count !== undefined && el("small", null, countLabel(row));
  const press = (e) => {
    if (env.absorbClick()) return;
    kind.press(env, row, e.shiftKey || e.ctrlKey || e.metaKey);
  };
  const keys = (e) => {
    if (e.key !== "F2" || !kind.renamable(row)) return;
    e.preventDefault();
    e.stopPropagation();
    env.startRename(row.key);
  };
  return el(
    "button",
    {
      type: "button",
      className: "wmc-layer-name",
      "data-key": row.key,
      title: row.title,
      onClick: press,
      onDoubleClick: () => kind.double(env, row),
      onContextMenu: (e) => kind.menu && kind.menu(env, row, e),
      onKeyDown: keys,
      onPointerDown: (e) => env.begin(e, row),
    },
    ...[caret, iconBox(row), title, count].filter(Boolean),
  );
}

function foldButton(row, env) {
  const key = row.open ? "Свернуть «{title}»" : "Раскрыть «{title}»";
  return el(
    "button",
    {
      type: "button",
      className: "wmc-layer-caret is-button",
      tabIndex: -1,
      "aria-label": mapText(key, { title: row.title }),
      onClick: () => env.fold(row.key),
    },
    foldArrow(row),
  );
}

function LayerRow({ row, env }) {
  const kind = kindOf(row);
  let lead;
  if (env.renameKey === row.key) {
    lead = el(
      Fragment,
      null,
      el("span", { className: "wmc-layer-caret", "aria-hidden": "true" }),
      iconBox(row),
      el(RenameField, { row, finish: env.finishRename }),
    );
  } else if (kind.caretButton) {
    lead = el(Fragment, null, foldButton(row, env), nameButton(row, kind, env));
  } else {
    lead = nameButton(row, kind, env);
  }
  const props = {
    className: rowClasses(row, env),
    style: row.depth === undefined ? undefined : { "--layer-depth": row.depth },
    role: "treeitem",
    "aria-level": row.depth + 1,
    "aria-expanded": kind.folds ? row.open : undefined,
    "aria-selected": kind.selectable ? row.selected : undefined,
  };
  return el("div", props, lead, ...rowToggles(row, kind, env));
}

function DockHead({ panel, open, total, inFrame, onDock, onFrame }) {
  const count = el("small", null, total);
  const staticTitle = { className: "wmc-layers-title is-static" };
  const title = panel
    ? el("span", staticTitle, el("b", null, tr("Всё на карте")), count)
    : el(
        "button",
        { type: "button", className: "wmc-layers-title", "aria-expanded": open, onClick: onDock },
        el(open ? CaretDown : CaretRight, { "aria-hidden": "true" }),
        el("b", null, tr("Слои")),
        count,
      );
  const chip =
    open &&
    total > 0 &&
    el(
      "button",
      {
        type: "button",
        className: inFrame ? "wmc-layers-chip is-on" : "wmc-layers-chip",
        "aria-pressed": inFrame,
        title: tr("Показывать только то, что сейчас видно на карте"),
        onClick: onFrame,
      },
      tr("В кадре"),
    );
  return el("header", { className: "wmc-layers-head" }, title, chip);
}

function SearchField({ query, onQuery, inputRef }) {
  const keys = (e) => {
    if (e.key !== "Escape" || !query) return;
    onQuery("");
    e.stopPropagation();
  };
  return el(
    "label",
    { className: "wmc-layers-search" },
    el(MagnifyingGlass, { "aria-hidden": "true" }),
    el("input", {
      ref: inputRef,
      placeholder: tr("Найти слой"),
      "aria-label": tr("Найти слой по имени"),
      type: "search",
      value: query,
      onChange: (e) => onQuery(e.target.value),
      onKeyDown: keys,
    }),
    query !== "" &&
      el(
        "button",
        { type: "button", "aria-label": tr("Очистить поиск"), onClick: () => onQuery("") },
        el(X),
      ),
  );
}

function emptyNote(total, inFrame, query) {
  if (!total) {
    return tr(
      "На карте пока нет объектов. Зоны, точки, надписи и картинки появятся здесь — их можно будет скрыть и закрепить.",
    );
  }
  return inFrame && !query.trim()
    ? tr("В кадре ничего нет — отдалите карту или выключите «В кадре».")
    : tr("Ничего не нашлось.");
}

function RowList(props) {
  const { rows, total, inFrame, query, panel, height, spot, env } = props;
  const { scrollRef, listApi, onKeys } = props;
  const note = emptyNote(total, inFrame, query);
  if (!(total > 0)) {
    return el("p", { className: "wmc-hint wmc-layers-empty is-compact" }, note);
  }
  const dropLine =
    spot &&
    spot.place !== "into" &&
    el("div", {
      className: "wmc-layers-drop",
      style: { top: `${(spot.index + (spot.place === "after" ? 1 : 0)) * LIMITS.rowHeight}px` },
      "aria-hidden": "true",
    });
  const body = rows.length
    ? el(VirtualList, {
        items: rows,
        rowHeight: LIMITS.rowHeight,
        renderRow: (row) => el(LayerRow, { key: row.key, row, env }),
        apiRef: listApi,
      })
    : el("p", { className: "wmc-hint wmc-layers-empty" }, note);
  return el(
    "div",
    {
      ref: scrollRef,
      className: env.dragKey === null ? "wmc-layers-scroll" : "wmc-layers-scroll is-dragging",
      style: panel ? undefined : { height },
      role: "tree",
      "aria-label": tr("Слои карты"),
      onKeyDown: onKeys,
    },
    dropLine,
    body,
  );
}

// ---- выключатели слоёв самой карты ----

const SWITCH_SPECS = [
  { id: "markers", name: "Подписи", ground: false },
  { id: "zones", name: "Зоны", ground: false },
  { id: "paint", name: "Рисунок", ground: false },
  { id: "roads", name: "Дороги", ground: true },
  { id: "buildings", name: "Постройки", ground: true },
  { id: "land", name: "Суша", ground: true },
];

function BaseLayerSwitches({ config, vector, onConfig }) {
  useTr();
  const language = useUiLanguage();
  const hidden = config.base.hidden ?? [];

  const flip = (spec, on) => {
    const label = tr(spec.name);
    if (spec.ground) {
      const rest = on ? hidden.concat(spec.id) : hidden.filter((layer) => layer !== spec.id);
      const base = { ...config.base, hidden: rest };
      const wording = on ? "Слой «{title}» скрыт" : "Слой «{title}» показан";
      onConfig(normalizeWorldMap({ ...config, base }), mapText(wording, { title: label }));
      return;
    }
    const part = { ...config[spec.id], enabled: !on };
    const wording = on ? "«{title}» скрыты" : "«{title}» показаны";
    onConfig(normalizeWorldMap({ ...config, [spec.id]: part }), mapText(wording, { title: label }));
  };

  const buttons = SWITCH_SPECS.flatMap((spec) => {
    if (spec.ground && !vector) return [];
    const on = spec.ground ? !hidden.includes(spec.id) : config[spec.id].enabled !== false;
    return [
      el(
        "button",
        {
          key: spec.id,
          type: "button",
          className: on ? "wmc-base-layer" : "wmc-base-layer is-off",
          "aria-pressed": on,
          title: mapText(on ? "Скрыть: {title}" : "Показать: {title}", {
            title: lowerFor(language, tr(spec.name)),
          }),
          onClick: () => flip(spec, on),
        },
        spec.ground &&
          el("i", { style: { background: config.base[spec.id] }, "aria-hidden": "true" }),
        el("span", null, tr(spec.name)),
        el(on ? Eye : EyeSlash, { "aria-hidden": "true" }),
      ),
    ];
  });
  const group = { className: "wmc-base-layers", role: "group", "aria-label": tr("Слои карты") };
  return el("div", group, buttons);
}

// ---- клавиши дерева ----

const TREE_KEYS = {
  ArrowDown: (t) => {
    t.event.preventDefault();
    const next = t.names[Math.min(t.names.length - 1, t.at + 1)];
    if (next) next.focus();
  },
  ArrowUp: (t) => {
    t.event.preventDefault();
    const next = t.names[Math.max(0, t.at - 1)];
    if (next) next.focus();
  },
  ArrowRight: (t) => {
    if (!t.row || t.row.open === undefined || t.row.open) return;
    t.event.preventDefault();
    t.fold(t.row.key);
  },
  ArrowLeft: (t) => {
    if (!t.row || !t.row.open) return;
    t.event.preventDefault();
    t.fold(t.row.key);
  },
};

// ---- панель ----

export default function WorldMapLayers({
  config,
  vector = false,
  selection,
  picked = [],
  frame,
  onPick,
  onPickGroup = null,
  onReorder = null,
  onConfig,
  onMenu,
  onRename,
  onRenameGroup = null,
  renameRequest = null,
  findRequest = 0,
  memoryId = "",
  panel = false,
}) {
  useTr();
  const dock = useDockPrefs();
  const [query, setQuery] = useState("");
  const [renameKey, setRenameKey] = useState(null);
  const [inFrame, setInFrame] = useMapMemory(memoryId, "layers:inFrame", false, ACCEPT.flag);
  const [toggledKeys, setToggledKeys] = useMapMemory(memoryId, "layers:toggled", [], ACCEPT.keys);
  const scrollRef = useRef(null);
  const listApi = useRef(null);
  const searchRef = useRef(null);
  const { setExpanded } = dock;

  const open = panel ? true : dock.expanded;
  const toggled = useMemo(() => new Set(toggledKeys), [toggledKeys]);
  const { rows, total, shown } = useMemo(
    () =>
      buildLayerRows(config, {
        toggled,
        query,
        frame: inFrame ? frame : null,
        selection,
        picked,
      }),
    [config, toggled, query, inFrame, frame, selection, picked],
  );
  const filtering = query.trim() !== "" || inFrame;
  const firstSelected = useMemo(() => rows.findIndex((r) => r.selected), [rows]);
  const drag = useRowDrag({ rows, onReorder, blocked: filtering, scrollRef });

  const selKind = selection?.kind;
  const selId = selection?.id;
  useEffect(() => {
    const api = listApi.current;
    if (firstSelected < 0 || !api || typeof api.scrollToIndex !== "function") return;
    api.scrollToIndex(firstSelected);
  }, [selKind, selId, firstSelected]);

  useEffect(() => {
    const target = renameRequest && renameRequest.target;
    if (!target) return;
    setExpanded(true);
    setQuery("");
    setInFrame(false);
    setRenameKey(`item:${target.kind}:${target.id}`);
  }, [renameRequest, setExpanded, setInFrame]);

  useEffect(() => {
    if (!findRequest) return undefined;
    setExpanded(true);
    const timer = setTimeout(() => searchRef.current && searchRef.current.focus(), 0);
    return () => clearTimeout(timer);
  }, [findRequest, setExpanded]);

  const fold = (key) =>
    setToggledKeys((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));

  const finishRename = (row, raw) => {
    setRenameKey(null);
    const name = raw === null ? "" : raw.trim();
    if (!name || name === row.title) return;
    const callback = row.type === "group" ? onRenameGroup : onRename;
    if (callback) callback(row.type === "group" ? row.group : row.target, name);
  };

  // действия кнопок строки: глаз, подпись, замок
  const act = {
    eye(row) {
      const show = !row.visible;
      onConfig(kindOf(row).show(config, row, show), tr(show ? "Слой показан" : "Слой скрыт"));
    },
    label(row) {
      const edit = kindOf(row).label;
      if (!edit) return;
      onConfig(edit(config, row), tr(row.labelOn ? "Подпись скрыта" : "Подпись показана"));
    },
    lock(row) {
      const edit = kindOf(row).lock;
      const lock = !row.locked;
      if (!edit) return;
      onConfig(edit(config, row, lock), tr(lock ? "Слой закреплён" : "Слой откреплён"));
    },
  };

  const spot = drag.view.spot;
  const env = {
    config,
    act,
    fold,
    onPick,
    onPickGroup,
    onMenu,
    renameKey,
    finishRename,
    startRename: setRenameKey,
    begin: drag.begin,
    absorbClick: drag.absorbClick,
    dragKey: drag.view.key,
    intoKey: spot && spot.place === "into" ? spot.key : null,
  };

  const onTreeKeys = (event) => {
    const here = event.target;
    if (!here.matches || !here.matches("button.wmc-layer-name")) return;
    const step = lookup(TREE_KEYS, event.key);
    if (!step) return;
    const names = Array.from(event.currentTarget.querySelectorAll("button.wmc-layer-name"));
    const row = rows.find((r) => r.key === here.dataset.key);
    step({ event, names, at: names.indexOf(here), row, fold });
  };

  const flipDock = () => {
    const next = !dock.expanded;
    setExpanded(next);
    browserStore.write(STORE_KEYS.open, next ? "1" : "0");
  };

  const grip =
    open &&
    !panel &&
    el("div", {
      className: "wmc-layers-grip",
      role: "separator",
      "aria-orientation": "horizontal",
      "aria-label": tr("Высота панели слоёв"),
      title: tr("Потяните, чтобы изменить высоту"),
      onPointerDown: (event) => beginResize(event, dock.height, dock.setHeight),
    });

  return el(
    "section",
    {
      className: ["wmc-layers", open && "is-open", panel && "is-panel"].filter(Boolean).join(" "),
      "aria-label": tr("Слои карты"),
    },
    grip,
    el(DockHead, {
      panel,
      open,
      total,
      inFrame,
      onDock: flipDock,
      onFrame: () => setInFrame(!inFrame),
    }),
    open && total > 0 && el(SearchField, { query, onQuery: setQuery, inputRef: searchRef }),
    open &&
      el(RowList, {
        rows,
        total,
        inFrame,
        query,
        panel,
        height: dock.height,
        spot,
        env,
        scrollRef,
        listApi,
        onKeys: onTreeKeys,
      }),
    open && el(BaseLayerSwitches, { config, vector: Boolean(vector), onConfig }),
    open &&
      filtering &&
      total > 0 &&
      el(
        "small",
        { className: "wmc-layers-foot" },
        mapText("Показано {shown} из {total}", { shown, total }),
      ),
  );
}
