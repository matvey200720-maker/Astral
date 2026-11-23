import { createElement as h, useState } from "react";
import { tr, useTr } from "../../locales/ui.js";
import ColorInput from "./ColorInput.jsx";
import { rememberColor } from "./ColorPicker.jsx";
import { useFrameCoalescedChange } from "./color-coalesce.js";

export { useFrameCoalescedChange } from "./color-coalesce.js";

const DIGITS = "([0-9a-f]{3}|[0-9a-f]{6})";
const LOOSE = new RegExp(`^#?${DIGITS}$`, "i");
const STRICT = new RegExp(`^#${DIGITS}$`, "i");
const DEFAULTS = { swatches: [], disabled: false, editable: false, className: "", alpha: 1, onAlphaChange: null };
const FALLBACK_COLOUR = "#000000";

const joinClasses = (...names) => names.filter(Boolean).join(" ");
const expand = (digits) => (digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits);

// Набранный или вставленный код: края обрезаются, один «#» снимается, остаток из 3 или 6 шестнадцатеричных знаков даёт #rrggbb.
export function parseHexInput(text) {
  const found = LOOSE.exec(String(text ?? "").trim());
  return found ? `#${expand(found[1]).toLowerCase()}` : "";
}

// Значение проекта: цвет только с «#»; иначе пустая строка.
const colourOf = (value) => {
  const found = STRICT.exec(String(value ?? "").trim());
  return found ? `#${expand(found[1]).toLowerCase()}` : "";
};

// Тихий код под полем: цвет (или значение как есть) прописными и, если есть обработчик прозрачности, «· NN %».
function quietCode(value, colour, alpha, alphaOn) {
  const percent = Math.round(alpha * 100);
  const suffix = alphaOn && percent < 100 ? ` · ${percent} %` : "";
  return `${(colour || String(value ?? "")).toUpperCase()}${suffix}`;
}

function withDefaults({ label, hint, value, onChange, ariaLabel, ...props }) {
  const own = { label, hint, value, onChange, ariaLabel };
  for (const [name, fallback] of Object.entries(DEFAULTS)) own[name] = props[name] === undefined ? fallback : props[name];
  return own;
}

// Поле кода: набранное живёт в нём, наружу уходит только готовый цвет; уход и Enter кладут его в «Недавние».
const KEY_ACTIONS = { Enter: "remember", Escape: "drop" };

function HexInput({ value, disabled, name, onChange }) {
  const [typed, retype] = useState(null);
  const leave = (remember) => {
    if (remember && typed !== null) rememberColor(parseHexInput(typed));
    retype(null);
  };
  return h("input", {
    className: "ui-color-hex",
    disabled,
    maxLength: 16,
    spellCheck: false,
    autoComplete: "off",
    "aria-label": name,
    type: "text",
    value: typed ?? String(value ?? ""),
    onChange(event) {
      retype(event.target.value);
      const colour = parseHexInput(event.target.value);
      if (colour) onChange?.(colour);
    },
    onBlur: () => leave(true),
    onKeyDown(event) {
      const action = Object.hasOwn(KEY_ACTIONS, event.key) ? KEY_ACTIONS[event.key] : null;
      if (action) leave(action === "remember");
    },
  });
}

export default function ColorField(props) {
  const { label, hint, value, onChange, ariaLabel, swatches, disabled, editable, className, alpha, onAlphaChange } = withDefaults(props);
  useTr();
  const { draft, input, commit, flush } = useFrameCoalescedChange(onChange);

  const colour = colourOf(value);
  const named = typeof label === "string";
  const fieldName = ariaLabel || (named ? label : undefined);
  const swatchLabel = named && label ? tr(label) : fieldName || tr("Цвет");
  const alphaOn = typeof onAlphaChange === "function";

  if (import.meta.env.DEV && value !== undefined && !colour) {
    console.warn(`ColorField «${fieldName || tr("без имени")}»: значение ${String(value)} — не цвет вида #rrggbb.`);
  }

  const picker = h(ColorInput, {
    value: draft ?? (colour || FALLBACK_COLOUR),
    disabled,
    "aria-label": fieldName,
    swatches,
    swatchLabel,
    alpha,
    onAlphaChange: alphaOn ? onAlphaChange : null,
    "data-swatch-label": swatchLabel,
    onChange(event) {
      (event.nativeEvent.type === "change" ? commit : input)(event.target.value);
    },
    onBlur: flush,
  });
  const readout = editable
    ? h(HexInput, { value, disabled, name: `${swatchLabel}: HEX`, onChange })
    : h("code", null, quietCode(value, colour, alpha, alphaOn));
  return h(
    "label",
    { className: joinClasses("ui-field ui-color", className) },
    h("span", { className: "ui-color-copy" }, label, hint && h("small", { title: typeof hint === "string" ? hint : undefined }, hint)),
    picker,
    readout,
  );
}
