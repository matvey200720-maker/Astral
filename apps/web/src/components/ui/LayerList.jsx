import { createElement as h, useId, useLayoutEffect, useRef, useState } from "react";
import Button from "./Button.jsx";
import useTabListKeys from "./useTabListKeys.js";

const ICON_SIZE = 28;
const ICON_GAP = 2;
const DEFAULTS = { role: "list", items: [], tools: null, footer: null, className: "" };

const joinClasses = (...names) => names.filter(Boolean).join(" ");

// Только названные свойства; undefined заменяется умолчанием, null остаётся.
function withDefaults({ label, value, onSelect, ...props }) {
  const own = { label, value, onSelect };
  for (const [name, fallback] of Object.entries(DEFAULTS)) own[name] = props[name] === undefined ? fallback : props[name];
  return own;
}

// Ширина ряда значков: n значков по ICON_SIZE и n − 1 зазоров.
const toolsWidth = (count) => count * ICON_SIZE + (count - 1) * ICON_GAP;

function toolButton(tool) {
  return h(Button, {
    key: tool.id,
    variant: "ghost",
    size: "sm",
    className: tool.danger ? "is-danger-tool" : "",
    icon: tool.icon,
    "aria-label": tool.label,
    title: tool.title || tool.label,
    disabled: tool.disabled,
    onClick: tool.onClick,
  });
}

// Кнопка строки: в tablist — закладка с одной остановкой таба, в списке — нажимаемая кнопка.
function pickButton({ item, selected, tabbed, ids, onSelect }) {
  const { id, title, meta, thumb, tooltip } = item;
  const mark = tabbed ? { role: "tab", "aria-selected": selected } : { "aria-pressed": selected };
  return h(
    "button",
    {
      type: "button",
      className: "ui-layer-pick",
      role: mark.role,
      "aria-selected": mark["aria-selected"],
      "aria-pressed": mark["aria-pressed"],
      "aria-labelledby": ids.title,
      "aria-describedby": meta ? ids.meta : undefined,
      tabIndex: tabbed ? (selected ? 0 : -1) : undefined,
      title: tooltip || undefined,
      onClick() {
        onSelect?.(id);
      },
    },
    h("span", { className: "ui-layer-thumb", "aria-hidden": "true" }, thumb),
    h("span", { className: "ui-layer-copy" }, h("span", { className: "ui-layer-title", id: ids.title }, title), meta && h("small", { className: "ui-layer-meta", id: ids.meta }, meta)),
  );
}

// Строка: проявляется, если пришла после первой фиксации списка; класс держится до конца анимации.
function LayerRow({ tabbed, selected, icons, shown, ...pick }) {
  const [entering, setEntering] = useState(() => shown.current);
  const Tag = tabbed ? "div" : "li";
  const props = {
    className: joinClasses("ui-layer-row", selected && "is-active", icons.length > 0 && "has-tools", entering && "is-entering"),
    style: icons.length > 0 ? { "--ui-layer-tools-w": `${toolsWidth(icons.length)}px` } : undefined,
    role: tabbed ? "presentation" : undefined,
    onAnimationEnd: entering ? () => setEntering(false) : undefined,
  };
  return h(Tag, props, pickButton({ ...pick, selected, tabbed }), icons.length > 0 ? h("span", { className: "ui-layer-tools" }, icons.map(toolButton)) : null);
}

export default function LayerList(props) {
  const { label, value, onSelect, role, items, tools, footer, className } = withDefaults(props);
  const base = useId();
  const shown = useRef(false);
  const tabbed = role === "tablist";
  const { listRef, onKeyDown } = useTabListKeys({ options: items.map((item) => ({ value: item.id })), value, onChange: onSelect, enabled: tabbed, orientation: "vertical" });

  useLayoutEffect(() => {
    shown.current = true;
  }, []);

  const rows = items.map((item, at) => {
    const icons = tools ? tools(item, at) : [];
    const ids = { title: `${base}-title-${at}`, meta: `${base}-meta-${at}` };
    return h(LayerRow, { key: item.id, tabbed, selected: value !== undefined && item.id === value, icons, shown, item, ids, onSelect });
  });
  const listProps = tabbed
    ? { ref: listRef, className: "ui-layer-rows", role: "tablist", "aria-orientation": "vertical", "aria-label": label, onKeyDown }
    : { className: "ui-layer-rows", "aria-label": label };
  return h("div", { className: joinClasses("ui-layer-list", className) }, rows.length ? h(tabbed ? "div" : "ul", listProps, rows) : null, footer && h("div", { className: "ui-layer-foot" }, footer));
}
