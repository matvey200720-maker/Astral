import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from "react";
import { tr, useTr } from "../../locales/ui.js";
import { createPortal } from "react-dom";

const EDGE = 8;
const ENABLED = ".ui-menu-item:not(:disabled)";
const DEFAULTS = { title: "", options: [] };

// Куда уходит фокус внутри меню: at — номер доступного пункта под фокусом (−1, если фокус не на пунктах).
const JUMPS = new Map([
  ["ArrowDown", (at, count) => (at + 1) % count],
  ["ArrowUp", (at, count) => (at - 1 + count) % count],
  ["Home", () => 0],
  ["End", (at, count) => count - 1],
]);

// Меню открывается у точки щелчка; не влезает — по другую сторону от точки, но не ближе EDGE к краю окна.
const settle = (point, size, room) => Math.max(EDGE, point + size > room - EDGE ? point - size : point);
const placeAt = (menu, x, y) => ({ left: settle(x, menu.offsetWidth, window.innerWidth), top: settle(y, menu.offsetHeight, window.innerHeight) });

const overlayHost = () => document.querySelector("[data-desktop-overlay-host]") || document.querySelector(".desktop-app") || document.body;

function withDefaults({ x, y, title, options, onSelect, onClose }) {
  const given = { title, options };
  const own = { x, y, onSelect, onClose };
  for (const [name, fallback] of Object.entries(DEFAULTS)) own[name] = given[name] === undefined ? fallback : given[name];
  return own;
}

function entryOf(option, at, actions) {
  if (option.separator) return h("div", { key: `separator-${at}`, role: "separator", className: "ui-menu-separator" });
  const { value, label, icon, shortcut, danger, disabled } = option;
  return h(
    "button",
    {
      key: value,
      type: "button",
      role: "menuitem",
      className: danger ? "ui-menu-item is-danger" : "ui-menu-item",
      disabled,
      onClick() {
        actions.onClose?.();
        actions.onSelect?.(value);
      },
    },
    icon,
    h("span", null, label),
    shortcut && h("kbd", { className: "ui-context-menu-key" }, shortcut),
  );
}

// Слушатели документа и окна: «куда, что, обработчик, остальные аргументы». Ставятся один раз с onClose первой отрисовки.
function wiring(menu, dismiss) {
  const away = (event) => !menu.contains(event.target);
  const when = (test) => (event) => {
    if (test(event)) dismiss();
  };
  return [
    [document, "pointerdown", when((event) => event.target instanceof Node && away(event)), true],
    [
      document,
      "keydown",
      (event) => {
        const isEscape = event.key === "Escape";
        if (!isEscape) return;
        event.stopImmediatePropagation();
        dismiss();
      },
      true,
    ],
    [document, "scroll", when(away), true],
    [window, "resize", dismiss],
    [window, "blur", dismiss],
  ];
}

function useDismissal(menuRef, firstClose) {
  useEffect(() => {
    const menu = menuRef.current;
    menu.querySelector(ENABLED)?.focus();
    const table = wiring(menu, () => {
      firstClose.current?.();
    });
    table.forEach(([host, type, listener, ...phase]) => host.addEventListener(type, listener, ...phase));
    return () => table.forEach(([host, type, listener, ...phase]) => host.removeEventListener(type, listener, ...phase));
  }, [menuRef, firstClose]);
}

export default function ContextMenu(props) {
  const { x, y, title, options, onSelect, onClose } = withDefaults(props);
  const menuRef = useRef(null);
  const firstClose = useRef(onClose);
  const [place, setPlace] = useState({ left: -9999, top: -9999 });
  useTr();

  useLayoutEffect(() => {
    setPlace(placeAt(menuRef.current, x, y));
  }, [x, y, options.length]);
  useDismissal(menuRef, firstClose);

  const navigate = (event) => {
    const items = [...menuRef.current.querySelectorAll(ENABLED)];
    if (!items.length) return;
    if (event.key === "Tab") {
      event.preventDefault();
      if (onClose) onClose();
      return;
    }
    const jump = JUMPS.get(event.key);
    if (!jump) return;
    event.preventDefault();
    items[jump(items.indexOf(document.activeElement), items.length)].focus();
  };

  const menu = h(
    "div",
    {
      className: "ui-menu ui-context-menu",
      role: "menu",
      "aria-label": title || tr("Действия"),
      style: place,
      ref: menuRef,
      onKeyDown: navigate,
      onContextMenu: (event) => void event.preventDefault(),
    },
    title ? h("div", { className: "ui-context-menu-title" }, title) : null,
    options.map((option, at) => entryOf(option, at, { onClose, onSelect })),
  );
  return createPortal(menu, overlayHost());
}
