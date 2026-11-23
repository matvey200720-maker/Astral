import { createElement as h } from "react";
import Button from "./Button.jsx";
import { CaretRight } from "./icons.jsx";

const rowClass = (extra) => (extra ? `ui-nav-row ${extra}` : "ui-nav-row");

// Набор для кнопки в порядке, который видит кнопка; всё из rest ложится поверх и может его перекрыть.
const buttonDefaults = (given) => ({
  className: rowClass(given.className),
  variant: "ghost",
  block: true,
  icon: given.icon,
  caption: given.caption,
  title: given.tooltip,
  trailing: h(CaretRight, { "aria-hidden": "true" }),
  onClick: given.onOpen,
});

export default function NavRow({ title, icon = null, caption = null, className = "", tooltip, onOpen, ...rest }) {
  const own = buttonDefaults({ className, icon, caption, tooltip, onOpen });
  return h(Button, Object.assign(own, rest), title);
}
