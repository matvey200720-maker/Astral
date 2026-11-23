import { createElement as h } from "react";

const joinClasses = (...names) => names.filter(Boolean).join(" ");

// Заголовок полки; число рисуется всегда, кроме null (ноль и строка тоже).
const headline = (title, count) => [h("h3", null, title), count !== null && h("small", null, count)];

// Сетка плиток: подпись — label, а если её нет, то заголовок.
const gridOf = ({ title, label, gridClassName, children }) =>
  h("div", { className: joinClasses("ui-preset-grid", gridClassName), role: "group", "aria-label": label || title }, children);

const foldingShelf = (parts) => {
  const { className, open, defaultOpen, onToggle, title, count } = parts;
  const report = (event) => {
    onToggle(event.currentTarget.open);
  };
  const own = { className: joinClasses("ui-presets", className), open: open ?? defaultOpen, onToggle: onToggle ? report : undefined };
  return h("details", own, h("summary", null, ...headline(title, count)), gridOf(parts));
};

const staticShelf = (parts) =>
  h("section", { className: joinClasses("ui-presets", "is-static", parts.className) }, h("header", null, ...headline(parts.title, parts.count)), gridOf(parts));

export default function PresetShelf({ title = "Готовые пресеты", label = null, count = null, open, defaultOpen = false, onToggle, className = "", gridClassName = "", collapsible = true, children }) {
  const parts = { title, label, count, open, defaultOpen, onToggle, className, gridClassName, children };
  return (collapsible ? foldingShelf : staticShelf)(parts);
}

const markOf = ({ key, colour, label }) => h("i", { key, style: colour ? { background: colour } : undefined, title: `${label}: ${colour}`, "aria-label": label });

// Цветные метки пресета в слоте картинки плитки; пусто — ничего.
export function PresetMarks({ marks }) {
  return marks?.length ? h("span", { className: "ui-preset-marks" }, marks.map(markOf)) : null;
}
