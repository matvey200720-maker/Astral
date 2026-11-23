import { createElement as h, useLayoutEffect as afterLayout, useState as slot } from "react";
import useTabListKeys from "./useTabListKeys.js";

const DEFAULTS = { options: [], className: "", optionClassName: "", size: "md", disabled: false, role: "group", indicator: false };
const FRESH_PLATE = { box: null, live: false };

const joinClasses = (...names) => names.filter(Boolean).join(" ");
const withDefaults = (props) => ({ ...props, ...Object.fromEntries(Object.entries(DEFAULTS).map(([name, fallback]) => [name, props[name] === undefined ? fallback : props[name]])) });

// Имя пункта для подсказки: своё title главнее строковой подписи, узловая подпись имени не даёт.
function nameOf(option) {
  if (option.title) return option.title;
  return typeof option.label === "string" ? option.label : undefined;
}

function faceOf(option) {
  if (!option.description) return h("span", { className: "ui-segment-label" }, option.label);
  return h("span", { className: "ui-segment-copy" }, h("b", null, option.label), h("small", null, option.description));
}

// Кнопка пункта; порядок свойств совпадает с порядком атрибутов в DOM.
function segmentOf(option, shared) {
  const { value, tabs, disabled, optionClassName, onChange } = shared;
  const active = option.value === value;
  const name = nameOf(option);
  const props = {
    key: option.value,
    type: "button",
    id: option.id || undefined,
    role: tabs ? "tab" : undefined,
    className: joinClasses("ui-segment", optionClassName, option.className, option.iconOnly && "is-icon", active && "is-active"),
    "aria-selected": tabs ? active : undefined,
    "aria-pressed": tabs ? undefined : active,
    "aria-controls": tabs ? option.controls || undefined : undefined,
    "aria-label": option.iconOnly ? name : option.ariaLabel || undefined,
    tabIndex: tabs ? (active ? 0 : -1) : undefined,
    disabled: disabled || option.disabled,
    title: name,
    lang: option.lang || undefined,
    onClick() {
      onChange?.(option.value);
    },
  };
  return h("button", props, option.icon, option.iconOnly ? null : faceOf(option));
}

// Место и размер выбранного сегмента среди прямых детей ряда.
function selectedBox(row) {
  const node = Array.from(row.children).find((child) => child.matches(".ui-segment.is-active"));
  if (!node) return null;
  return { x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight };
}

const sameBox = (a, b) => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

// Замер сразу, затем повторно при любом срабатывании наблюдателя за рядом, плашкой и пунктами; без ResizeObserver остаётся один замер.
function watchRow(row, measure) {
  measure();
  if (typeof ResizeObserver !== "function") return undefined;
  const watcher = new ResizeObserver(measure);
  [row, ...Array.from(row.children)].forEach((node) => watcher.observe(node));
  return () => watcher.disconnect();
}

// Плашка: коробка выбранного сегмента и «проезд» (live), который включается при первой смене значения и больше не гаснет.
function usePlate(rowRef, indicator, value, options) {
  const [startValue] = slot(value);
  const [plate, setPlate] = slot(FRESH_PLATE);
  if (indicator && !plate.live && value !== startValue) setPlate({ ...plate, live: true });
  const valuesKey = options.map((option) => option.value).join("|");

  afterLayout(() => {
    const row = rowRef.current;
    const apply = (next) => setPlate((prev) => (sameBox(prev.box, next) ? prev : { ...prev, box: next }));
    if (!indicator || !row) {
      apply(null);
      return undefined;
    }
    return watchRow(row, () => apply(selectedBox(row)));
  }, [indicator, value, valuesKey]);

  return { box: indicator ? plate.box : null, live: indicator && plate.live };
}

const boxStyle = (box) => ({ "--plate-x": `${box.x}px`, "--plate-y": `${box.y}px`, "--plate-w": `${box.w}px`, "--plate-h": `${box.h}px` });

export default function SegmentedControl(props) {
  const { options, value, onChange, label, className, optionClassName, size, disabled, role, indicator } = withDefaults(props);
  const tabs = role === "tablist";
  const { listRef, onKeyDown } = useTabListKeys({ options, value, onChange, enabled: tabs && !disabled });
  const { box, live } = usePlate(listRef, indicator, value, options);
  const shared = { value, tabs, disabled, optionClassName, onChange };

  const rowProps = {
    className: joinClasses("ui-segmented", `is-${size}`, indicator && "has-plate", className),
    role,
    "aria-label": label,
    "data-plate": box ? "" : undefined,
    style: box ? boxStyle(box) : undefined,
    "data-live": live ? "" : undefined,
    ref: listRef,
    onKeyDown,
  };
  const plateNode = indicator ? h("span", { className: "ui-segmented-plate", "aria-hidden": "true" }) : null;
  return h("div", rowProps, plateNode, options.map((option) => segmentOf(option, shared)));
}
