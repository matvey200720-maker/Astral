import { createElement as h } from "react";
import Dialog from "./Dialog.jsx";
import Kbd from "./Kbd.jsx";
import { tr, useTr } from "../../locales/ui.js";

// Плашки подряд: клавиши нажимают вместе; ключ — подпись и место, повторы допустимы.
const caps = (keys) => keys.map((key, index) => h(Kbd, { key: `${key}-${index}` }, key));

const pairOf = ({ keys, label }) => h("div", { key: label }, h("dt", null, caps(keys)), h("dd", null, label));

const sectionOf = ({ group, items }) => h("section", { key: group }, h("h3", null, group), h("dl", null, items.map(pairOf)));

export default function ShortcutsDialog({ open, onClose, kicker = null, groups = [] }) {
  useTr();
  const frame = { open, onClose, title: tr("Горячие клавиши"), kicker, size: "sm", className: "ui-shortcuts" };
  return h(Dialog, frame, groups.map(sectionOf));
}
