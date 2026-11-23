import { createElement, useRef, useEffect } from "react";
import { tr, useTr } from "../../../../locales/ui.js";

const h = createElement;

const LINE_CAP = 4;
const ZERO_WIDTH = String.fromCharCode(0x200b);
const TWIN_AUDIT = "type-min type-scale caps";
const FIELD_AUDIT = `${TWIN_AUDIT} hit-target`;

// Как рисуется текст: пары [свойство стиля, как получить значение из font].
const TEXT_LOOK = [
  ["fontFamily", (f) => f.family],
  ["fontWeight", (f) => f.weight],
  ["fontSize", (f) => f.size + "px"],
  ["lineHeight", (f) => f.lineHeight + "px"],
  ["letterSpacing", (f) => (f.spacing || 0) + "px"],
  ["textTransform", (f) => (f.upper ? "uppercase" : "none")],
  ["color", (f) => f.color],
];

// Один объект стиля на двойник и поле.
function textLook(font) {
  const style = Object.fromEntries(TEXT_LOOK.map(([prop, read]) => [prop, read(font)]));
  const outlined = font.stroke && font.strokeWidth;
  if (outlined) style.WebkitTextStroke = font.strokeWidth * 2 + "px " + font.stroke;
  return { ...style, paintOrder: "stroke fill" };
}

// Попытки взять фокус: сразу, в кадре и через 60 мс. Возвращает общую отмену.
function pursueFocus(fieldRef) {
  const grab = () => {
    const field = fieldRef.current;
    const settled = !field || document.activeElement === field;
    if (settled) return;
    field.focus({ preventScroll: true });
    field.select();
  };
  const retries = [
    [(job) => requestAnimationFrame(job), cancelAnimationFrame],
    [(job) => setTimeout(job, 60), clearTimeout],
  ];
  grab();
  const pending = retries.map(([start, stop]) => [stop, start(grab)]);
  return () => pending.forEach(([stop, ticket]) => stop(ticket));
}

const swallow = (event) => event.stopPropagation();
const toUnix = (text) => text.split(/\r\n?/).join("\n");

function closesField({ key, shiftKey }) {
  if (key === "Escape") return true;
  return key === "Enter" && !shiftKey;
}

function rootStyle({ left, top, wrapWidth, rotation }) {
  return Object.assign(
    { left, top },
    wrapWidth ? { width: wrapWidth } : null,
    { transform: `translate(-50%, -50%) rotate(${rotation}deg)` },
  );
}

export default function MapLabelEditor(props) {
  const { draft, left, top, font, onChange, onDone } = props;
  const rotation = props.rotation === undefined ? 0 : props.rotation;
  const wrapWidth = props.wrapWidth === undefined ? null : props.wrapWidth;
  const focusKey = props.focusKey === undefined ? "" : props.focusKey;
  useTr();
  const fieldRef = useRef(null);
  useEffect(() => pursueFocus(fieldRef), [focusKey]);

  const style = textLook(font);
  const plain = draft === undefined || draft === null ? "" : String(draft);

  const reactToKey = (event) => {
    if (closesField(event)) {
      event.preventDefault();
      event.stopPropagation();
      onDone();
      return;
    }
    const overflow = event.key === "Enter" && draft.split("\n").length >= LINE_CAP;
    if (overflow) event.preventDefault();
    swallow(event);
  };

  const twin = h(
    "span",
    { className: "wmc-label-edit-size", "aria-hidden": "true", style, "data-audit-ignore": TWIN_AUDIT },
    (plain || " ") + ZERO_WIDTH,
  );
  const field = h("textarea", {
    className: "wmc-label-edit-input",
    ref: fieldRef,
    rows: 1,
    spellCheck: false,
    autoComplete: "off",
    "aria-label": tr("Текст подписи на карте"),
    "data-audit-ignore": FIELD_AUDIT,
    style,
    value: draft,
    onChange: (event) => onChange(toUnix(event.target.value)),
    onBlur: onDone,
    onKeyDown: reactToKey,
  });
  const shell = {
    className: ["wmc-label-edit", wrapWidth && "is-wrapped"].filter(Boolean).join(" "),
    "data-map-type": "",
    style: rootStyle({ left, top, wrapWidth, rotation }),
    onPointerDown: swallow,
    onDoubleClick: swallow,
  };
  return h("div", shell, twin, field);
}
