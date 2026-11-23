import { createElement as h, Fragment, useState } from "react";
import { tr, useTr } from "../../locales/ui.js";
import { CaretDown, CaretRight, Palette } from "./icons.jsx";
import ListGroup, { ListRow, ListSub, ListSwatch } from "./ListGroup.jsx";
import ColorSwatches from "./ColorSwatches.jsx";

// Умолчания действуют только для не заданных (undefined); null и пустые значения остаются как есть.
const DEFAULTS = { title: "", value: null, caption: null, colours: [], names: null, specials: [], auto: "Как в игре", label: "", onClear: null, group: false, groupTitle: "", defaultOpen: false, children: null };
const NAMED = [...Object.keys(DEFAULTS), "onChange", "icon"];

function settle(props) {
  const given = Object.fromEntries(Object.entries(props).filter(([, one]) => one !== undefined));
  const extra = Object.fromEntries(Object.entries(props).filter(([name]) => !NAMED.includes(name)));
  return [{ ...DEFAULTS, ...given }, extra];
}

// Справа в строке: кружок цвета и стрелка раскрытия (вниз у раскрытой, вправо у свёрнутой).
function tail(colour, opened) {
  const arrow = h(opened ? CaretDown : CaretRight, { "aria-hidden": "true" });
  return h(Fragment, null, h(ListSwatch, { colour }), arrow);
}

// Выбор в палитре: цвет — наружу, «как в игре» — снятие, и только если цвет был.
const picker = (cfg) => (next) => {
  if (next) cfg.onChange?.(next);
  else if (cfg.value) cfg.onClear?.();
};

export default function ColourRow(props) {
  const [cfg, extra] = settle(props);
  useTr();
  const [opened, setOpened] = useState(cfg.defaultOpen);
  const name = cfg.title || tr("Цвет");
  const shown = cfg.caption ?? (cfg.value ? String(cfg.value).toUpperCase() : tr(cfg.auto));
  const row = h(ListRow, {
    icon: props.icon === undefined ? h(Palette) : props.icon,
    title: name,
    caption: shown,
    trailing: tail(cfg.value, opened),
    expanded: opened,
    onOpen: () => setOpened((was) => !was),
    onClear: cfg.value ? cfg.onClear : null,
    "data-colour-row": "",
    ...extra,
  });
  const paletteName = cfg.label || name;
  const palette = h(ColorSwatches, { label: paletteName, value: cfg.value, colours: cfg.colours, names: cfg.names, specials: cfg.specials, auto: tr(cfg.auto), onChange: picker(cfg) });
  const card = opened && h(ListSub, { "data-colour-row-card": "" }, cfg.children ?? palette);
  const parts = h(Fragment, null, row, card);
  return cfg.group ? h(ListGroup, { title: cfg.groupTitle, label: paletteName }, parts) : parts;
}
