import { createElement as h, useEffect } from "react";
import { CaretLeft } from "./icons.jsx";
import Button from "./Button.jsx";

// Окно поверх страницы: диалог или подложка внутри оверлейного хоста.
const WINDOW_OPEN = "[role='dialog'], .desktop-overlay-host [role='presentation']";

const subscribe = (target, type, handler) => {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
};

// Escape возвращает назад, но не из-под окна: окна слушают ту же клавишу и её не гасят.
const escapeHandler = (goBack) => (event) => {
  const pressed = event.key === "Escape";
  if (pressed && !document.querySelector(WINDOW_OPEN)) goBack();
};

// Квадрат md с одним значком (имя только в атрибутах) или малая кнопка с подписью.
const backLooks = {
  true: (label) => ({ size: "md", name: label, face: null }),
  false: (label) => ({ size: "sm", name: undefined, face: label }),
};

function backButton(onBack, label, iconOnly) {
  const { size, name, face } = backLooks[Boolean(iconOnly)](label);
  const given = { className: "ui-detail-back", variant: "ghost", size, icon: h(CaretLeft), ariaLabel: name, title: name, onClick: onBack };
  return h(Button, given, face);
}

export default function DetailTopbar({ onBack, backLabel, backIconOnly = false, trail = null, actions = null, className = "" }) {
  useEffect(() => (onBack ? subscribe(document, "keydown", escapeHandler(onBack)) : undefined), [onBack]);
  const end = actions && h("span", { className: "ui-detail-topbar-end" }, actions);
  return h("header", { className: `ui-detail-topbar ${className}`.trim() }, backButton(onBack, backLabel, backIconOnly), trail, end);
}
