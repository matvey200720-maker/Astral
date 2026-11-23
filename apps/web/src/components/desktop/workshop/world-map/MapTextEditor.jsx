import { createElement, useRef, useEffect } from "react";
import { tr, useTr } from "../../../../locales/ui.js";

const h = createElement;

const LINE_LIMIT = 8;
const AUDIT_OFF = ["type-min", "type-scale", "caps", "hit-target"].join(" ");

// Ручки по порядку DOM: [классы, вид для onGrip, подсказка (ключ tr), ключ элемента]
const GRIP_SPANS = [
  ["wmc-type-edge is-top", "move", "Перетащить надпись", "top"],
  ["wmc-type-edge is-right", "move", "Перетащить надпись", "right"],
  ["wmc-type-edge is-bottom", "move", "Перетащить надпись", "bottom"],
  ["wmc-type-edge is-left", "move", "Перетащить надпись", "left"],
  ["wmc-type-grip is-nw", "corner-0", "Размер", "nw"],
  ["wmc-type-grip is-ne", "corner-1", "Размер", "ne"],
  ["wmc-type-grip is-se", "corner-2", "Размер", "se"],
  ["wmc-type-grip is-sw", "corner-3", "Размер", "sw"],
  ["wmc-type-stem", null, null, "stem"],
  ["wmc-type-grip is-rotate", "rotate", "Повернуть", "rotate"],
];

// Стиль поля: [свойство, поле font, единица]
const FIELD_STYLE = [
  ["fontFamily", "family", ""],
  ["fontWeight", "weight", ""],
  ["fontSize", "size", "px"],
  ["lineHeight", "lineHeight", "px"],
  ["letterSpacing", "spacing", "px"],
];

function fieldStyle(font) {
  const pairs = FIELD_STYLE.map(([prop, source, unit]) => [prop, unit ? `${font[source]}${unit}` : font[source]]);
  return Object.fromEntries(pairs);
}

// Фокус тремя заходами (сразу, кадр, 60 мс); каретка в конец текста.
function pursueCaret(fieldRef) {
  const grab = () => {
    const field = fieldRef.current;
    if (field && document.activeElement !== field) {
      field.focus({ preventScroll: true });
      const end = field.value.length;
      field.setSelectionRange(end, end);
    }
  };
  const later = [
    [(job) => requestAnimationFrame(job), cancelAnimationFrame],
    [(job) => setTimeout(job, 60), clearTimeout],
  ];
  grab();
  const tickets = later.map(([begin, cancel]) => ({ cancel, id: begin(grab) }));
  return () => {
    for (const { cancel, id } of tickets) cancel(id);
  };
}

const stopEvent = (event) => event.stopPropagation();

function pressGrip(onGrip, kind) {
  return (event) => {
    if (event.button === 0 && onGrip) {
      event.preventDefault();
      event.stopPropagation();
      onGrip(event, kind);
    }
  };
}

function gripSpans(onGrip) {
  return GRIP_SPANS.map(([className, kind, hint, key]) => {
    if (!kind) return h("span", { key, className, "aria-hidden": "true" });
    return h("span", { key, className, title: tr(hint), onPointerDown: pressGrip(onGrip, kind) });
  });
}

// Что делать с клавишей: закончить ввод, запретить перенос или пропустить.
function verdictOf(event, draft) {
  const { key, ctrlKey, metaKey } = event;
  if (key === "Escape") return "finish";
  if (key === "Enter" && (ctrlKey || metaKey)) return "finish";
  if (key === "Enter" && draft.split("\n").length >= LINE_LIMIT) return "block";
  return "pass";
}

export default function MapTextEditor(props) {
  const { draft, left, top, width, height, font, onChange, onDone } = props;
  const rotation = props.rotation === undefined ? 0 : props.rotation;
  const grips = props.grips === undefined ? false : props.grips;
  const onGrip = props.onGrip === undefined ? null : props.onGrip;
  const focusKey = props.focusKey === undefined ? "" : props.focusKey;
  useTr();
  const fieldRef = useRef(null);
  useEffect(() => pursueCaret(fieldRef), [focusKey]);

  const reactions = {
    finish: (event) => {
      event.preventDefault();
      event.stopPropagation();
      onDone();
    },
    block: (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    pass: stopEvent,
  };

  const field = h("textarea", {
    className: "wmc-type-input",
    ref: fieldRef,
    wrap: "off",
    rows: 1,
    spellCheck: false,
    autoComplete: "off",
    "aria-label": tr("Текст надписи на карте"),
    "data-audit-ignore": AUDIT_OFF,
    style: fieldStyle(font),
    value: draft,
    onChange: (event) => onChange(event.target.value),
    onKeyDown: (event) => reactions[verdictOf(event, draft)](event),
  });
  const frame = { left, top, width, height };
  const root = {
    className: grips ? "wmc-type has-grips" : "wmc-type",
    "data-map-type": "",
    style: { ...frame, transform: `translate(-50%, -50%) rotate(${rotation}deg)` },
    onPointerDown: stopEvent,
    onDoubleClick: stopEvent,
  };
  return h("div", root, field, grips && gripSpans(onGrip));
}
