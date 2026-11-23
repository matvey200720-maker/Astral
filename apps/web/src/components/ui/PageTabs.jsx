import { cloneElement, createElement as h, isValidElement, useLayoutEffect as beforePaint, useRef, useState } from "react";
import useTabListKeys from "./useTabListKeys.js";

const ACTIVE_TAB = ".ui-page-tab.is-active";
const KINDS = new Set(["tablist", "group"]);
const DEFAULTS = { options: [], role: "navigation", className: "" };

// Что вкладка говорит о выборе — по виду полосы: навигация, вкладки над панелью, выбор вида.
const MARKS = {
  navigation: (on) => ({ current: on ? "page" : undefined }),
  tablist: (on, { controls }) => ({ role: "tab", selected: on, controls: controls || undefined, tabIndex: on ? 0 : -1 }),
  group: (on) => ({ pressed: on }),
};

// Умолчания вместо undefined; остальных свойств полоса не берёт.
function withDefaults({ options, value, onChange, label, role, className }) {
  const given = { options, role, className };
  const own = { value, onChange, label };
  for (const [name, fallback] of Object.entries(DEFAULTS)) own[name] = given[name] === undefined ? fallback : given[name];
  return own;
}

const placeOf = (tab) => ({ x: tab.offsetLeft, y: tab.offsetTop, w: tab.offsetWidth, h: tab.offsetHeight });
const samePlace = (a, b) => ["x", "y", "w", "h"].every((side) => a[side] === b[side]);
const plateStyle = ({ x, y, w, h: height }) => ({ "--plate-x": `${x}px`, "--plate-y": `${y}px`, "--plate-w": `${w}px`, "--plate-h": `${height}px` });

// Плашка после замера: нет выбранной — гаснет на месте; те же числа у горящей — прежняя; иначе встаёт.
const nextPlate = (prev, place) => {
  if (!place) return prev && prev.on ? { ...prev, on: false } : prev;
  return prev && prev.on && samePlace(prev, place) ? prev : { ...place, on: true };
};
const withPlate = (view, place) => {
  const plate = nextPlate(view.plate, place);
  return plate === view.plate ? view : { ...view, plate };
};

// Наблюдатель размера: сам ряд, затем каждый прямой ребёнок по порядку (плашка тоже).
function watchTabs(root, measure) {
  const observer = new ResizeObserver(measure);
  [root, ...Array.from(root.children)].forEach((node) => observer.observe(node));
  return () => observer.disconnect();
}

// Плашка и проезд: первое чтение мест — по уведомлению наблюдателя, смена выбора и состава — сразу.
function usePlate(listRef, value, roster) {
  const [view, setView] = useState(() => ({ firstValue: value, live: false, plate: null }));
  const launched = useRef(false);

  if (!view.live && value !== view.firstValue) setView({ ...view, live: true });

  const measure = () => {
    const root = listRef.current;
    if (root == null) return;
    const children = Array.from(root.children);
    const chosenTab = children.find((node) => node.matches(ACTIVE_TAB));
    const place = chosenTab ? placeOf(chosenTab) : null;
    setView((before) => withPlate(before, place));
  };

  beforePaint(() => {
    const canWatch = typeof ResizeObserver === "function";
    const readNow = launched.current || !canWatch;
    if (readNow) measure();
    launched.current = true;
    if (!canWatch) return undefined;
    return watchTabs(listRef.current, measure);
  }, [value, roster]);

  return view;
}

// Значок вкладки: готовый элемент клонируется, компонент и тег создаются; начертание и aria-hidden ставятся всегда.
function iconFor(icon, selected) {
  if (!icon) return null;
  const extra = { weight: selected ? "fill" : "regular", "aria-hidden": true };
  return isValidElement(icon) ? cloneElement(icon, extra) : h(icon, extra);
}

function tabButton(option, { kind, value, onChange }) {
  const { value: code, label, title, icon, id, disabled } = option;
  const selected = code === value;
  const marks = MARKS[kind](selected, option);
  return h(
    "button",
    {
      key: code,
      type: "button",
      id: id || undefined,
      role: marks.role,
      className: selected ? "ui-page-tab is-active" : "ui-page-tab",
      "data-tab": code,
      "aria-current": marks.current,
      "aria-selected": marks.selected,
      "aria-pressed": marks.pressed,
      "aria-controls": marks.controls,
      tabIndex: marks.tabIndex,
      disabled,
      title: title || (typeof label === "string" ? label : undefined),
      onClick() {
        onChange?.(code);
      },
    },
    iconFor(icon, selected),
    h("span", { className: "ui-page-tab-label" }, label),
  );
}

export default function PageTabs(props) {
  const { options, value, onChange, label, role, className } = withDefaults(props);
  const kind = KINDS.has(role) ? role : "navigation";
  const keys = useTabListKeys({ options, value, onChange, enabled: kind === "tablist" });
  const { plate, live } = usePlate(keys.listRef, value, options.map((option) => option.value).join("|"));

  const rootProps = {
    className: `ui-page-tabs ${className}`.trim(),
    role: kind === "navigation" ? undefined : kind,
    "aria-label": label,
    "data-plate": plate && plate.on ? "" : undefined,
    style: plate ? plateStyle(plate) : undefined,
    "data-live": live ? "" : undefined,
    ref: keys.listRef,
    onKeyDown: kind === "tablist" ? keys.onKeyDown : undefined,
  };
  const tabs = options.map((option) => tabButton(option, { kind, value, onChange }));
  return h(kind === "navigation" ? "nav" : "div", rootProps, h("span", { className: "ui-page-tabs-plate", "aria-hidden": "true" }), tabs);
}

export function PageBar({ children, actions = null, className = "" }) {
  return h("div", { className: `ui-page-bar ${className}`.trim() }, children, actions ? h("div", { className: "ui-page-bar-actions" }, actions) : null);
}
