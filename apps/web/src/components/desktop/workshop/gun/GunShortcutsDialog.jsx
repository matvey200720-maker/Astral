import { tr, useTr } from "../../../../locales/ui.js";
import Dialog from "../../../ui/Dialog.jsx";
import Kbd from "../../../ui/Kbd.jsx";
import { GUN_SHORTCUTS } from "./gun-shortcuts.js";
import { createElement as h } from "react";

export default function GunShortcutsDialog({ onClose, open, weapon = true }) {
  useTr();

  const frame = {
    open,
    onClose,
    title: tr("Горячие клавиши"),
    kicker: weapon ? tr("Мастерская оружия") : tr("Мастерская одежды"),
    size: "sm",
    className: "gun-shortcuts",
  };
  return h(Dialog, frame, Array.from(visible(GUN_SHORTCUTS, weapon), (group) => groupNode(group, weapon)));
}

/** Пометка `weaponOnly` прячет группу или строку, когда окно открыто для одежды. */
function* visible(list, weapon) {
  for (const item of list) {
    if (weapon || !item.weaponOnly) yield item;
  }
}

function groupNode({ group, items }, weapon) {
  const rows = Array.from(visible(items, weapon), rowNode);
  return h("section", { key: group }, h("h3", null, tr(group)), h("dl", null, rows));
}

function rowNode({ keys, label }) {
  const caps = keys.map((name, at) => h(Kbd, { key: at }, tr(name)));
  return h("div", { key: label }, h("dt", null, caps), h("dd", null, tr(label)));
}
