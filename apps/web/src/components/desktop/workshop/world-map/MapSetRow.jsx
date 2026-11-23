import { createElement as el } from "react";
import { CaretDown, CaretRight, Eye, EyeSlash, TextAa } from "../../../ui/icons.jsx";
import { MARKER_CATEGORY_MAP, normalizeWorldMap, patchMapGroup } from "@modovik/vector-map";
import ColorPicker from "../../../ui/ColorPicker.jsx";
import Switch from "../../../ui/Switch.jsx";
import { GroupLabelStyle } from "../WorldMapSetsPanels.jsx";
import { patchObject } from "../world-map-editing.js";
import { useMapMemory } from "../world-map-memory.js";
import { ColorLine, Disclosure } from "./MapPanelParts.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { mapText, setTitle } from "./map-copy.js";

const WHITE = "#ffffff";

// в памяти проекта допустимо только булево, иное — значение по умолчанию
const keepBoolean = (saved, fallback) => (typeof saved === "boolean" ? saved : fallback);

// ---------- цвет объектов набора ----------

const categoryColor = (config, item) => config.markers.categories[item.category]?.color;

// как читать и записывать цвет набора: зоны, «только подписи», значки
const SET_COLOR = {
  zones: {
    name: (mixed) => (mixed ? tr("Цвет набора · разные") : tr("Цвет набора")),
    read: (item) => item.color,
    write: (color) => ({ color, fillColor: null }),
  },
  text: {
    name: (mixed) => (mixed ? tr("Цвет текста · разные") : tr("Цвет текста")),
    read: (item, config) => item.labelColor || item.color || categoryColor(config, item) || WHITE,
    write: (labelColor) => ({ labelColor }),
  },
  icons: {
    name: (mixed) => (mixed ? tr("Цвет значков · разные") : tr("Цвет значков")),
    read: (item, config) => item.color || categoryColor(config, item) || WHITE,
    write: (color) => ({ color }),
  },
};

// «только подписи»: объекты есть, и у каждого категория известна и без значка
const labelsOnly = (items) =>
  items.length > 0 && items.every((item) => MARKER_CATEGORY_MAP[item.category]?.glyph === "none");

function colorMode(section, items) {
  if (section === "zones") return SET_COLOR.zones;
  return labelsOnly(items) ? SET_COLOR.text : SET_COLOR.icons;
}

// ---------- список объектов набора ----------

function itemRow(item, ctx) {
  const { config, kind, onConfig, onSelect } = ctx;
  const name = item.name;
  const target = { kind, id: item.id };
  const labelShown = item.label !== false;
  const enabled = item.enabled;
  const patch = (change, caption, prop) => onConfig(patchObject(config, target, change), caption, prop);

  const swatch = el(ColorPicker, {
    label: mapText("Цвет «{name}»", { name }),
    size: "sm",
    value: kind === "zone" ? item.color : item.color || categoryColor(config, item) || WHITE,
    onChange: (color) => patch({ color }, tr("Цвет объекта"), `${kind}.color.${item.id}`),
  });

  const title = onSelect
    ? el(
        "button",
        {
          type: "button",
          className: "wmc-set-item-name",
          title: tr("Выбрать на карте"),
          onClick: () => onSelect(target),
        },
        name,
      )
    : el("span", { className: "wmc-set-item-name" }, name);

  const labelEye = el(
    "button",
    {
      type: "button",
      className: "wmc-eye wmc-eye-text",
      "aria-pressed": labelShown,
      "aria-label": mapText(labelShown ? "Скрыть подпись «{name}»" : "Показать подпись «{name}»", { name }),
      title: labelShown ? tr("Скрыть подпись") : tr("Показать подпись"),
      onClick: () =>
        patch({ label: item.label === false }, item.label === false ? tr("Подпись показана") : tr("Подпись скрыта")),
    },
    el(TextAa),
  );

  const eye = el(
    "button",
    {
      type: "button",
      className: "wmc-eye",
      "aria-pressed": enabled,
      "aria-label": mapText(enabled ? "Скрыть «{name}»" : "Показать «{name}»", { name }),
      title: enabled ? tr("Скрыть") : tr("Показать"),
      onClick: () => patch({ enabled: !item.enabled }, item.enabled ? tr("Скрыто") : tr("Показано")),
    },
    el(enabled ? Eye : EyeSlash),
  );

  return el("li", { key: item.id, className: enabled ? "" : "is-hidden" }, swatch, title, labelEye, eye);
}

// отдельным компонентом, чтобы строки создавались только у открытой раскрывашки
function SetItems({ items, config, section, onConfig, onSelect }) {
  const ctx = { config, kind: section === "zones" ? "zone" : "marker", onConfig, onSelect };
  return el("ul", { className: "wmc-set-items" }, items.map((item) => itemRow(item, ctx)));
}

// ---------- тело раскрытой строки ----------

function switchLine(caption, switchProps) {
  return el(
    "label",
    { className: "ui-field wmc-switch-line" },
    el("span", null, caption),
    el(Switch, switchProps),
  );
}

function setBody(ctx) {
  const { config, section, group, onConfig, onSelect, memoryId, tag, title } = ctx;
  const zones = section === "zones";
  const items = config[section].items.filter((item) => (item.group || "") === group.id);
  const send = (change, caption, prop) =>
    onConfig(patchMapGroup(config, section, group.id, change), caption, prop);

  const turnLabels = (on) => {
    let next = patchMapGroup(config, section, group.id, { label: on });
    if (zones && on) next = normalizeWorldMap({ ...next, zones: { ...next.zones, labels: true } });
    const caption = on ? tr("Подписи набора показаны") : tr("Подписи набора скрыты");
    onConfig(next, caption, `group.label.${group.id}`);
  };
  const labelsOn = items.some((item) => item.label !== false);
  const fillOn = items.some((item) => item.fill !== false);

  const lines = [
    switchLine(tr("Подписи"), {
      checked: labelsOn,
      label: mapText("Подписи набора «{title}»", { title }),
      onChange: turnLabels,
    }),
  ];
  if (zones) {
    lines.push(
      switchLine(tr("Заливка"), {
        checked: fillOn,
        label: mapText("Заливка набора «{title}»", { title }),
        onChange: (on) => {
          const caption = on ? tr("Заливка набора включена") : tr("Заливка набора выключена");
          send({ fill: on }, caption, `group.fill.${group.id}`);
        },
      }),
    );
  }

  if (items.length > 0) {
    const mode = colorMode(section, items);
    const seen = new Set(items.map((item) => String(mode.read(item, config))));
    const colors = [
      el(ColorLine, {
        key: "set",
        label: mode.name(seen.size > 1),
        value: mode.read(items[0], config),
        onChange: (color) => send(mode.write(color), tr("Цвет набора"), `group.color.${group.id}`),
      }),
    ];
    if (zones && fillOn) {
      colors.push(
        el(ColorLine, {
          key: "fill",
          label: tr("Цвет заливки"),
          value: items[0].fillColor || items[0].color,
          onChange: (fillColor) =>
            send({ fillColor }, tr("Цвет заливки набора"), `group.fillColor.${group.id}`),
        }),
      );
    }
    lines.push(el("div", { className: "wmc-color-lines" }, colors));
  }

  const font = el(
    Disclosure,
    { label: tr("Шрифт и вид подписей"), memoryId, memoryKey: `setfont:${section}:${tag}` },
    el(GroupLabelStyle, { config, section, group, onConfig }),
  );
  const inside =
    items.length > 0
      ? el(
          Disclosure,
          {
            label: mapText("Что внутри · {count}", { count: items.length }),
            memoryId,
            memoryKey: `setitems:${section}:${tag}`,
          },
          el(SetItems, { items, config, section, onConfig, onSelect }),
        )
      : null;

  return el("div", { className: "wmc-set-row-body" }, ...lines, font, inside);
}

// ---------- шапка ----------

function rowHead({ group, title, open, flip, onVisible }) {
  const visible = group.visible;
  const toggle = el(
    "button",
    {
      type: "button",
      className: "wmc-set-row-toggle",
      "aria-expanded": open,
      "aria-label": mapText(open ? "Свернуть набор «{title}»" : "Раскрыть набор «{title}»", { title }),
      onClick: flip,
    },
    el(open ? CaretDown : CaretRight),
    el("b", null, title),
    el("small", null, group.count),
  );
  const eye = el(
    "button",
    {
      type: "button",
      className: "wmc-eye",
      "aria-pressed": visible,
      "aria-label": mapText(visible ? "Скрыть набор «{title}»" : "Показать набор «{title}»", { title }),
      title: visible ? tr("Скрыть набор") : tr("Показать набор"),
      onClick: () => onVisible(!group.visible),
    },
    el(visible ? Eye : EyeSlash),
  );
  return el("div", { className: "wmc-set-row-head" }, toggle, eye);
}

// ---------- строка набора ----------

export default function MapSetRow({
  config,
  section,
  group,
  onConfig,
  onVisible,
  onSelect = null,
  memoryId = "",
}) {
  useTr();
  const tag = group.id || "own";
  const [open, setOpen] = useMapMemory(memoryId, `setopen:${section}:${tag}`, false, keepBoolean);
  const title = setTitle(group.title);

  const classes = ["wmc-set-row", group.visible ? null : "is-hidden", open ? "is-open" : null];
  const body = open ? setBody({ config, section, group, onConfig, onSelect, memoryId, tag, title }) : null;

  return el(
    "li",
    { className: classes.filter(Boolean).join(" "), "data-set-row": tag },
    rowHead({ group, title, open, flip: () => setOpen(!open), onVisible }),
    body,
  );
}
