import { createElement as h, useId, useState } from "react";
import { tr, useTr } from "../../locales/ui.js";
import { usePanelHelp } from "./panel-help.js";
import { Question, X } from "./icons.jsx";
import NavRow from "./NavRow.jsx";
import Button from "./Button.jsx";

const joinClasses = (...names) => names.filter(Boolean).join(" ");

// Делит свойства на названные (с умолчаниями для undefined) и остальные: остальные идут на корень как есть.
function splitProps(props, defaults, extra = []) {
  const known = new Set([...Object.keys(defaults), ...extra]);
  const own = { ...defaults };
  const rest = {};
  for (const [name, value] of Object.entries(props)) {
    if (!known.has(name)) rest[name] = value;
    else if (value !== undefined || !(name in defaults)) own[name] = value;
  }
  return [own, rest];
}

const GROUP_DEFAULTS = { title: "", help: null, label: "", plain: false, className: "" };
const ROW_DEFAULTS = { icon: null, caption: null, onClear: null, clearLabel: "", disabled: false, lead: null, className: "" };
const ROW_EXTRA = ["title", "trailing", "onOpen", "expanded", "tooltip", "aria-current", "aria-pressed"];

// ---------- ListGroup ----------

// Кнопка «?»: подсказка под курсором и раскрытие заметки; Escape закрывает только открытую.
function HelpButton({ open, noteId, text, setOpen }) {
  return h(Button, {
    size: "sm",
    variant: "ghost",
    className: joinClasses("ui-list-group-help-button", open && "is-open"),
    icon: h(Question, { "aria-hidden": "true" }),
    ariaLabel: tr("Подсказка"),
    title: text,
    "aria-expanded": open,
    "aria-controls": noteId,
    onClick(event) {
      event.stopPropagation();
      setOpen((value) => !value);
    },
    onKeyDown(event) {
      if (event.key !== "Escape" || !open) return;
      event.stopPropagation();
      setOpen(false);
    },
  });
}

export default function ListGroup(props) {
  useTr();
  const [own, rest] = splitProps(props, GROUP_DEFAULTS, ["children"]);
  const { children, className, help, label, plain, title } = own;
  const noteId = useId();
  const [open, setOpen] = useState(false);

  const tips = [help].flat(Infinity).filter(Boolean);
  const noteText = tips.join(" ");
  const shellTookIt = usePanelHelp(title ? [] : tips);
  const showHelp = tips.length > 0 && !shellTookIt;

  const heading = title ? h("h4", { className: "ui-list-group-title" }, title) : h("span", null);
  const helpButton = showHelp ? h(HelpButton, { noteId, open, setOpen, text: noteText }) : null;
  const head = title || showHelp ? h("div", { className: "ui-list-group-head" }, heading, helpButton) : null;
  const note =
    showHelp && open ? h("div", { id: noteId, className: "ui-list-group-help", role: "note" }, noteText) : null;
  const body = plain ? children : h("div", { className: "ui-list-group-list" }, children);

  return h(
    "div",
    {
      className: joinClasses("ui-list-group", className),
      role: "group",
      "aria-label": label || title || undefined,
      ...rest,
    },
    head,
    note,
    body,
  );
}

// ---------- ListRow ----------

// Свойства строки NavRow; порядок задан контрактом соседа: хвост — по условию, запись без нажатия — как div.
function navProps(own) {
  const { icon, title, caption, disabled, expanded, tooltip, onOpen, trailing } = own;
  const props = { className: "ui-list-group-main", icon, title, caption, disabled, "aria-expanded": expanded, "aria-current": own["aria-current"], "aria-pressed": own["aria-pressed"], tooltip, onOpen };
  if (trailing !== undefined) props.trailing = trailing;
  if (!onOpen) Object.assign(props, { as: "div", trailing: trailing ?? null });
  return props;
}

function ClearButton({ title, clearLabel, onClear }) {
  const word = clearLabel || tr("как в игре");
  return h(Button, { size: "sm", variant: "ghost", className: "ui-list-group-clear", icon: h(X, { "aria-hidden": "true" }), ariaLabel: `${title}: ${word}`, title: word, onClick: onClear });
}

export function ListRow(props) {
  const [own, rest] = splitProps(props, ROW_DEFAULTS, ROW_EXTRA);
  useTr();
  const { lead, onClear } = own;
  const wrapper = { className: joinClasses("ui-list-group-row", onClear && "is-set", lead && "has-lead", own.className), ...rest };
  return h("div", wrapper, lead && h("span", { className: "ui-list-group-lead" }, lead), h(NavRow, navProps(own)), onClear && h(ClearButton, { title: own.title, clearLabel: own.clearLabel, onClear }));
}

// ---------- ListSub, ListSwatch, ListThumb ----------

export function ListSub({ children, className = "", ...rest }) {
  return h("div", { className: joinClasses("ui-list-group-sub", className), ...rest }, children);
}

export function ListSwatch({ colour = null }) {
  return h("span", { className: joinClasses("ui-list-group-swatch", !colour && "is-empty"), style: colour ? { "--ui-list-swatch": colour } : undefined, "aria-hidden": "true" });
}

export function ListThumb({ src = "" }) {
  return h("span", { className: "ui-list-group-thumb" }, src ? h("img", { alt: "", draggable: "false", src }) : null);
}
