import { createElement as h } from "react";
import { tr, useTr } from "../../locales/ui.js";
import ColorInput from "./ColorInput.jsx";
import { normalizeHex, rememberColor, useRecentColors } from "./ColorPicker.jsx";
import { useFrameCoalescedChange } from "./color-coalesce.js";
import { Check, Plus } from "./icons.jsx";

const PLACES = 16;
const DEFAULTS = { colours: [], auto: "", names: null, specials: [], recent: 3, ariaName: null, alpha: 1, onAlphaChange: null, disabled: false, className: "" };

const joinClasses = (...names) => names.filter(Boolean).join(" ");
const lower = (code) => String(code).toLowerCase();
const mark = (Glyph) => h(Glyph, { weight: "bold", "aria-hidden": "true" });

// Умолчания только вместо undefined: null остаётся как есть, лишние свойства не берутся.
function withDefaults(props) {
  const own = { label: props.label, value: props.value, onChange: props.onChange };
  for (const [name, fallback] of Object.entries(DEFAULTS)) own[name] = props[name] === undefined ? fallback : props[name];
  return own;
}

// Выбранный код (ложное значение — «как в игре»): равен коду образца точно или без учёта регистра.
const isPicked = (picked, code) => picked === code || (picked !== null && code !== null && lower(picked) === lower(code));

// Образцы ряда как данные: код, подпись, добавочный класс, ключ.
const autoSpec = (word) => ({ key: "auto", code: null, name: tr(word) });
const specialSpec = ({ value, label, className }) => ({ key: `special-${value}`, code: value, name: tr(label), extra: className });
const recentSpec = (code) => ({ key: `recent-${code}`, code, name: `${tr("Недавний цвет")} ${code.toUpperCase()}`, extra: "is-recent" });

// Сколько «Недавних» влезает: ряд не длиннее двух строк по восемь, один путь занят образцом «Свой цвет».
const roomForRecent = (wanted, taken) => Math.max(0, Math.min(wanted, PLACES - (taken + 1)));

function swatchButton(spec, { picked, label, ariaName, disabled, onPick }) {
  const { code, name, extra } = spec;
  const colour = normalizeHex(code);
  const lit = isPicked(picked, code);
  return h(
    "button",
    {
      key: spec.key,
      type: "button",
      className: joinClasses("ui-color-swatch", code == null && "is-auto", extra, lit && "is-active"),
      style: colour ? { background: colour } : undefined,
      "aria-label": ariaName ? ariaName(name) : `${label}: ${name}`,
      "aria-pressed": lit,
      title: name,
      disabled,
      onClick() {
        if (colour) rememberColor(code);
        onPick(code);
      },
    },
    lit && mark(Check),
  );
}

// «Свой цвет»: метка с полем цвета; правки поля идут наружу не чаще раза за кадр.
function OwnColour({ label, value, lit, disabled, alpha, onAlphaChange, onChange }) {
  const { draft, input, commit, flush } = useFrameCoalescedChange(onChange);
  const shown = draft ?? normalizeHex(value);
  const named = lit && shown;
  const title = tr("Свой цвет");
  return h(
    "label",
    {
      className: joinClasses("ui-color-swatch is-custom", lit && "is-active"),
      style: named ? { background: shown } : undefined,
      title: named ? `${title} ${shown.toUpperCase()}` : title,
    },
    h(ColorInput, {
      className: "ui-color-native",
      value: shown || "#ffffff",
      "aria-label": `${label}: ${tr("свой цвет")}`,
      disabled,
      alpha,
      onAlphaChange,
      onChange(event) {
        const settled = event.nativeEvent.type === "change";
        (settled ? commit : input)(event.target.value);
      },
      onBlur: flush,
    }),
    mark(lit ? Check : Plus),
  );
}

export default function ColorSwatches(props) {
  const own = withDefaults(props);
  const { label, value, onChange, disabled } = own;
  useTr();
  const stored = useRecentColors();
  const picked = value || null;

  const base = [...(own.auto ? [autoSpec(own.auto)] : []), ...own.colours.map((code) => ({ key: code, code, name: (own.names && own.names(code)) || code })), ...own.specials.map(specialSpec)];
  const fresh = stored.filter((code) => !base.some((spec) => isPicked(code, spec.code)));
  const recents = fresh.slice(0, roomForRecent(own.recent, base.length)).map(recentSpec);
  const shown = [...base, ...recents];
  const lit = picked !== null && !shown.some((spec) => isPicked(picked, spec.code));

  const rootProps = { className: joinClasses("ui-color-swatches is-quick", own.className), role: "group", "aria-label": label, "aria-disabled": disabled || undefined };
  const env = { picked, label, ariaName: own.ariaName, disabled, onPick: onChange };
  const swatches = shown.map((spec) => swatchButton(spec, env));
  return h("div", rootProps, swatches, h(OwnColour, { label, value, lit, disabled, alpha: own.alpha, onAlphaChange: own.onAlphaChange, onChange }));
}
