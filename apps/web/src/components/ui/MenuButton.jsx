// Меню-кнопка: список вариантов открывается порталом в оверлейном слое окна,
// а не внутри кнопки. Выбор приходит снаружи (`value`), своего выбора нет.
import {
  createElement as h,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Button from "./Button.jsx";
import { CaretDown, Check } from "./icons.jsx";
import { placeBelowAnchor, resolveOverlayHost } from "./overlay-anchor.js";

/** Класс из частей: ложное отбрасывается, остальное приводится к строке как есть. */
const cx = (...parts) => parts.filter(Boolean).join(" ");

/** Место списка до первого замера: за экраном. */
const offscreenStyle = () => ({ top: -9999, left: -9999 });

/** Пункты списка, до которых можно дойти: кнопки `ui-menu-item` без `disabled`. */
function enabledItems(list) {
  const buttons = list ? list.querySelectorAll("button.ui-menu-item") : [];
  return Array.from(buttons).filter((button) => !button.disabled);
}

/**
 * Сосед по кругу. Если фокус не на пункте (`from` = -1), шаг назад даёт
 * предпоследний пункт: так закреплено в поведении.
 */
const around = (items, from, step) => items[(from + step + items.length) % items.length];

/** Клавиши списка: действие получает доступные пункты, индекс текущего и выход на кнопку. */
const LIST_KEYS = new Map([
  ["ArrowDown", ({ items, current }) => around(items, current, 1).focus()],
  ["ArrowUp", ({ items, current }) => around(items, current, -1).focus()],
  ["Home", ({ items }) => items[0].focus()],
  ["End", ({ items }) => items[items.length - 1].focus()],
  ["Tab", ({ leave }) => leave()],
]);

/** Отмечен ли пункт: своя `selected` (если задана) сильнее сравнения значений. */
const isMarked = (option, value) =>
  option.selected !== undefined ? option.selected : option.value === value;

/**
 * Дети списка в порядке `options`. Номера в ключах и в `id` названий —
 * позиции в исходном массиве; название действует на пункты до разделителя
 * или следующего названия.
 */
function renderEntries(options, { menuId, value, optionClassName, choose }) {
  const selectable = value !== undefined;
  let groupId;

  return options.map((option, index) => {
    if (option.separator) {
      groupId = undefined;
      return h("div", {
        key: `separator-${index}`,
        role: "separator",
        className: "ui-menu-separator",
      });
    }

    if (option.heading) {
      groupId = `${menuId}-heading-${index}`;
      return h(
        "div",
        { key: `heading-${index}`, id: groupId, role: "presentation", className: "ui-menu-heading" },
        option.heading,
      );
    }

    const mark = selectable ? isMarked(option, value) : undefined;
    return h(
      "button",
      {
        key: option.value,
        type: "button",
        role: selectable ? "menuitemradio" : "menuitem",
        "aria-checked": mark,
        "aria-describedby": groupId,
        className: cx(
          "ui-menu-item",
          optionClassName,
          option.className,
          option.danger && "is-danger",
          mark && "is-active active",
        ),
        disabled: option.disabled,
        title: option.title || undefined,
        onClick: () => choose(option),
      },
      option.icon,
      h("span", null, option.label),
      mark && h(Check),
    );
  });
}

export default function MenuButton({
  options = [],
  value,
  icon = null,
  label,
  onSelect,
  trailing = h(CaretDown),
  align = "start",
  buttonClassName = "",
  className = "",
  menuClassName = "",
  optionClassName = "",
  size = "sm",
  variant = "secondary",
  ariaLabel,
  title,
  disabled = false,
}) {
  const buttonId = useId();
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const [isOpen, setOpen] = useState(false);
  const [style, setStyle] = useState(offscreenStyle);
  // сведения об открытии, они не должны вызывать перерисовку
  const openedByKeyboard = useRef(false);
  const alignOnOpen = useRef(align);
  const optionCount = options.length;

  const dismiss = useCallback(() => setOpen(false), []);
  const dismissToButton = useCallback(() => {
    setOpen(false);
    rootRef.current?.querySelector("button")?.focus();
  }, []);

  const place = useCallback((edge) => {
    const anchorRect = rootRef.current?.getBoundingClientRect();
    if (!anchorRect) return;
    setStyle(placeBelowAnchor(anchorRect, edge, listRef.current?.offsetHeight));
  }, []);

  const openMenu = (byKeyboard) => {
    openedByKeyboard.current = byKeyboard;
    // `resize` считает по `align` на момент открытия, даже если его потом сменили
    alignOnOpen.current = align;
    setStyle(offscreenStyle());
    setOpen(true);
  };

  // Замер до кадра: при открытии, смене `align` и числа пунктов
  useLayoutEffect(() => {
    if (isOpen) place(align);
  }, [isOpen, place, align, optionCount]);

  useLayoutEffect(() => {
    if (isOpen && openedByKeyboard.current) enabledItems(listRef.current)[0]?.focus();
  }, [isOpen]);

  // Подписки живут, пока список открыт
  useEffect(() => {
    if (!isOpen) return undefined;

    const isInside = (node) => rootRef.current?.contains(node) || listRef.current?.contains(node);

    const onPointerDown = (event) => {
      if (!isInside(event.target)) dismiss();
    };
    const onKeyDown = (event) => {
      const escapePressed = event.key === "Escape";
      if (!escapePressed) return;
      event.stopImmediatePropagation();
      dismissToButton();
    };
    const onScroll = (event) => {
      if (!listRef.current?.contains(event.target)) dismiss();
    };
    const onResize = () => place(alignOnOpen.current);

    // порядок подписки и снятия один и тот же
    const subscriptions = [
      [document, "pointerdown", onPointerDown],
      [document, "keydown", onKeyDown, true],
      [document, "scroll", onScroll, true],
      [window, "resize", onResize],
    ];
    subscriptions.forEach(([target, type, ...rest]) => target.addEventListener(type, ...rest));
    return () => {
      subscriptions.forEach(([target, type, ...rest]) => target.removeEventListener(type, ...rest));
    };
  }, [isOpen, dismiss, dismissToButton, place]);

  const toggle = (event) => {
    // detail 0 — Enter, пробел или программный click(); мышь даёт 1 и больше
    if (isOpen) dismiss();
    else openMenu(event.detail === 0);
  };

  const handleButtonKey = (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    if (isOpen) enabledItems(listRef.current)[0]?.focus();
    else openMenu(true);
  };

  const choose = (option) => {
    dismiss();
    if (typeof onSelect === "function") onSelect(option.value);
  };

  const handleListKey = (event) => {
    const action = LIST_KEYS.get(event.key);
    if (!action) return;
    const items = enabledItems(listRef.current);
    if (items.length === 0) return;
    event.preventDefault();
    action({ items, current: items.indexOf(document.activeElement), leave: dismissToButton });
  };

  // слой выбираем заново при каждой отрисовке открытого списка
  const host = isOpen ? resolveOverlayHost() : null;

  return h(
    "div",
    {
      ref: rootRef,
      className: cx("ui-menu-button", `is-${align}`, isOpen && "is-open", className),
    },
    h(
      Button,
      {
        className: buttonClassName,
        variant,
        size,
        icon,
        trailing,
        disabled,
        id: buttonId,
        "aria-haspopup": "menu",
        "aria-expanded": isOpen,
        "aria-label": ariaLabel || undefined,
        title: title || ariaLabel || undefined,
        onClick: toggle,
        onKeyDown: handleButtonKey,
      },
      label,
    ),
    host &&
      createPortal(
        h(
          "div",
          {
            ref: listRef,
            className: cx("ui-menu", menuClassName),
            role: "menu",
            "aria-labelledby": buttonId,
            style,
            onKeyDown: handleListKey,
          },
          renderEntries(options, { menuId: buttonId, value, optionClassName, choose }),
        ),
        host,
      ),
  );
}
