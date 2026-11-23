import { createElement as h } from "react";
import { tr, useTr } from "../../locales/ui.js";

const classNames = (...parts) => parts.filter(Boolean).join(" ");

// Одна строка-кнопка: подсказка и id попадают в атрибуты, только когда они есть.
const actionRow = ({ id, label, onClick, danger, title }) =>
  h(
    "button",
    {
      key: id,
      type: "button",
      className: classNames("ui-list-group-action-row", danger && "is-danger"),
      "data-action": id,
      title: title || undefined,
      onClick,
    },
    label,
  );

// Имя карточки для читалки: заданное вызывающим, иначе слово из словаря.
const cardProps = (className, label) => ({
  className: classNames("ui-list-group-actions", className),
  role: "group",
  "aria-label": label || tr("Действия"),
});

export default function ActionRows(props) {
  const { actions = [], label = "", className = "" } = props;
  const lines = actions.filter(Boolean);
  useTr();
  return lines.length ? h("div", cardProps(className, label), lines.map(actionRow)) : null;
}
