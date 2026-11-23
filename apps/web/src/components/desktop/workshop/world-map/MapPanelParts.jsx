import { createElement } from "react";
import { mapText } from "./map-copy.js";
import Button from "../../../ui/Button.jsx";
import ColorPicker from "../../../ui/ColorPicker.jsx";
import { useMapMemory } from "../world-map-memory.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { Eye, EyeSlash, CaretDown, CaretRight, ArrowCounterClockwise } from "../../../ui/icons.jsx";

const h = createElement;

const orElse = (value, fallback) => (value === undefined ? fallback : value);

const colorRow = (key, label, extra) => ({ key, label, ...extra });

export const MAIN_COLORS = Object.freeze(
  [
    ["land", "Суша"],
    ["roads", "Дороги"],
    ["buildings", "Постройки"],
  ].map(([key, label]) => colorRow(key, label, { layer: key })),
);

export const MORE_COLORS = Object.freeze([
  colorRow("highways", "Магистрали"),
  colorRow("terrain", "Лес и горы"),
  colorRow("sand", "Пустыня и пляжи"),
  colorRow("rail", "Железная дорога", { fallback: "roads" }),
  colorRow("runway", "Взлётные полосы"),
  colorRow("edgeGlowColor", "Свечение берега"),
]);

// Строка классов: основа плюс те имена, у которых флаг истинен.
function joinClasses(base, extras) {
  let out = base;
  for (const [on, name] of extras) {
    if (on) out += " " + name;
  }
  return out;
}

// Возвращает сам флаг, если он ложный: ноль остаётся «0» на экране, как было.
const when = (flag, make) => flag && make();

// ---- раздел панели ----
export function PanelSection(props) {
  const title = orElse(props.title, null);
  const actions = orElse(props.actions, null);
  const hint = orElse(props.hint, null);
  const extraClass = orElse(props.className, "");
  const heading = h("h3", null, orElse(props.icon, null), title);
  const header = title || actions ? h("header", null, heading, actions) : null;
  const note = hint ? h("small", { className: "wmc-hint" }, hint) : null;
  const box = "ui-panel wmc-section wmc-map-section";
  const className = extraClass ? box + " " + extraClass : box;
  return h("section", { className }, header, note, props.children);
}

// ---- раскрывашка ----
const keepBoolean = (saved) => (typeof saved === "boolean" ? saved : undefined);

export function Disclosure(props) {
  const memoryId = orElse(props.memoryId, "");
  const memoryKey = props.memoryKey || "disclosure:none";
  const startOpen = orElse(props.defaultOpen, false);
  const [open, setOpen] = useMapMemory(memoryId, memoryKey, startOpen, keepBoolean);
  const caret = h(CaretDown, { className: "wmc-disclosure-caret", "aria-hidden": "true" });
  const head = h(
    Button,
    {
      variant: "ghost",
      size: "sm",
      block: true,
      className: "wmc-disclosure-toggle",
      "aria-expanded": open,
      trailing: caret,
      onClick: () => setOpen(!open),
    },
    props.label,
  );
  const body = open ? h("div", { className: "wmc-disclosure-body" }, props.children) : null;
  return h("div", { className: joinClasses("wmc-disclosure", [[open, "is-open"]]) }, head, body);
}

// ---- строка цвета ----
function eyeButton(extraClass, attrs, onClick, icon) {
  const className = extraClass ? "wmc-eye " + extraClass : "wmc-eye";
  return h("button", { type: "button", className, ...attrs, onClick }, icon);
}

export function ColorLine(props) {
  const { label, value, defaultValue, onChange } = props;
  const hidden = orElse(props.hidden, null);
  const onHidden = orElse(props.onHidden, null);
  const changed = orElse(props.changed, false);
  const onReset = orElse(props.onReset, null);
  useTr();
  const name = tr(label);

  const undo = when(changed && onReset, () =>
    eyeButton(
      "wmc-reset",
      { "aria-label": mapText("Вернуть цвет «{name}»", { name }), title: tr("Вернуть как было") },
      onReset,
      h(ArrowCounterClockwise),
    ),
  );
  const eye = when(onHidden, () => {
    const verb = hidden ? "Показать слой" : "Скрыть слой";
    const attrs = {
      "aria-pressed": !hidden,
      "aria-label": mapText(hidden ? "Показать слой «{name}»" : "Скрыть слой «{name}»", { name }),
      title: tr(verb),
    };
    return eyeButton("", attrs, () => onHidden(!hidden), h(hidden ? EyeSlash : Eye));
  });

  const kids = [
    h(ColorPicker, { label: name, value, defaultValue, onChange }),
    h("span", null, name, when(changed, () => h("i", { className: "wmc-changed-dot", "aria-hidden": "true" }))),
    undo,
    eye,
  ];
  const className = joinClasses("wmc-color-line", [[hidden, "is-hidden"], [changed, "is-changed"]]);
  return h("div", { className }, ...kids);
}

// ---- строка перехода на другую страницу ----
export function NavRow(props) {
  const { page, title, onOpen } = props;
  const rowProps = {
    variant: "ghost",
    block: true,
    className: "wmc-nav-row",
    icon: orElse(props.icon, null),
    caption: orElse(props.caption, null),
    trailing: h(CaretRight, { "aria-hidden": "true" }),
    "data-map-page": page,
    onClick: () => onOpen(page),
  };
  return h(Button, rowProps, title);
}
