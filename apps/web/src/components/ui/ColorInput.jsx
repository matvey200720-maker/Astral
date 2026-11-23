import { createElement as h, Fragment, useMemo, useRef } from "react";
import { tr } from "../../locales/ui.js";
import { useColorPopover } from "./ColorPicker.jsx";

// Свойства, которые поле берёт себе; всё остальное ложится на <input> до собственных атрибутов.
const OWN_PROPS = ["value", "onClick", "defaultValue", "aria-label", "title", "disabled", "swatches", "swatchLabel", "alpha", "onAlphaChange", "ref"];
const passThrough = (props) => Object.fromEntries(Object.entries(props).filter(([name]) => !OWN_PROPS.includes(name)));

// Цвет из палитры возвращается в поле настоящими событиями: значение ставится родным сеттером
// (в обход учёта React), затем поле получает событие; пустой код и отсутствие поля — ничего.
const sendNative = (type) => (field, hex) => {
  if (!field || !hex) return;
  const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  nativeSet.call(field, hex);
  field.dispatchEvent(new Event(type, { bubbles: true }));
};
const sendInput = sendNative("input");
const sendChange = sendNative("change");

// Что палитре считать якорем: поле с нормальным прямоугольником, а если оно спрятано точкой,
// то ближайшая подпись-обёртка, затем родитель, а без родителя — само поле.
function visibleAnchor(field) {
  const box = field.getBoundingClientRect();
  if (Math.min(box.width, box.height) >= 4) return field;
  return field.closest("label") ?? field.parentElement ?? field;
}

// Одна ссылка на поле для нас и для владельца (объект или функция); функция получает узел и null.
function useFieldRef(outer) {
  const field = useRef(null);
  const joined = useMemo(
    () => (node) => {
      field.current = node;
      if (typeof outer === "function") outer(node);
      else if (outer) outer.current = node;
    },
    [outer],
  );
  return [field, joined];
}

// Палитра Astral вместо системного окна: якорь выбирается при щелчке, имя — из подписи, подсказки или слова «Цвет».
function useColorPalette(props, field) {
  const { value, defaultValue = "", swatches = [], swatchLabel = "", alpha = 1, onAlphaChange = null } = props;
  const anchorRef = useRef(null);
  const palette = useColorPopover({
    label: props["aria-label"] || props.title || tr("Цвет"),
    onCommit: (hex) => sendChange(field.current, hex),
    onChange: (hex) => sendInput(field.current, hex),
    onAlphaChange,
    swatchLabel,
    defaultValue,
    swatches,
    anchorRef,
    alpha,
    value,
  });
  return { anchorRef, ...palette };
}

export default function ColorInput(props) {
  const [field, joinedRef] = useFieldRef(props.ref ?? null);
  const { anchorRef, open, setOpen, popover } = useColorPalette(props, field);
  const disabled = props.disabled ?? false;
  const press = (event) => {
    props.onClick?.(event);
    event.preventDefault();
    if (disabled) return;
    anchorRef.current = visibleAnchor(event.currentTarget);
    setOpen((was) => !was);
  };
  const own = { type: "color", value: props.value, title: props.title, "aria-label": props["aria-label"], "aria-haspopup": "dialog", "aria-expanded": open, disabled, onClick: press, ref: joinedRef };
  return h(Fragment, null, h("input", Object.assign(passThrough(props), own)), popover);
}
