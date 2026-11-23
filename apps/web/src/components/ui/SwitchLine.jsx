import { createElement as h } from "react";
import Switch from "./Switch.jsx";

const lineClass = (extra) => ["fx-switch", extra].filter(Boolean).join(" ");

// Ложное пояснение тега не даёт, «0» остаётся текстом.
const caption = (label, hint) => h("span", null, h("b", null, label), hint && h("small", null, hint));

export default function SwitchLine({ label, hint = null, checked, onChange, disabled = false, className = "" }) {
  const knob = h(Switch, { checked, label, disabled, onChange });
  return h("label", { className: lineClass(className) }, caption(label, hint), knob);
}
