import { createElement as h, Fragment, useMemo, useRef, useState } from "react";
import { tr, useTr } from "../../../../locales/ui.js";
import { mapText, setTitle, trForms } from "./map-copy.js";
import { counted } from "../../../../plural.js";
import {
  FONT_FAMILIES,
  MARKER_CATEGORY_MAP,
  ZONE_PALETTES,
  mapGroupStyle,
  mapGroups,
  normalizeWorldMap,
  paletteSwatch,
  patchMapGroup,
  recolorZones,
  setMapGroupLabelStyle,
  setMapGroupStyle,
  setMapGroupVisible,
  zoneGroupLook,
} from "@modovik/vector-map";
import { patchObject } from "../world-map-editing.js";
import { SaveSetPage, saveOfPage } from "./MapOwnSets.jsx";
import { SetsCatalog, standingLabelGroup } from "./MapSetsCatalog.jsx";
import { LabelsLook, ZonesLook } from "./MapSetsLook.jsx";
import { ColorLine, Disclosure, PanelSection } from "./MapPanelParts.jsx";
import { AlignChoice, FillChoice, LineChoice, ZoneSample } from "./MapLookPictures.jsx";
import { CaseChoice } from "./MapChoicePictures.jsx";
import LabelFontList from "./MapLabelFonts.jsx";
import { labelWeightOptions } from "./label-options.js";
import { meshEditCount, restoreAllMeshLabels } from "./mesh-label-editing.js";
import { Swatches } from "../world-map-panel-parts.jsx";
import Select from "../../../ui/Select.jsx";
import Switch from "../../../ui/Switch.jsx";
import Slider from "../../../ui/Slider.jsx";
import Button from "../../../ui/Button.jsx";
import {
  CaretRight,
  Eye,
  EyeSlash,
  FloppyDisk,
  MagnifyingGlass,
  Shuffle,
  Stack,
  TextAa,
} from "../../../ui/icons.jsx";

// ---------- данные и разбор страницы ----------

const SECTIONS = {};
SECTIONS.labels = "markers";
SECTIONS.zones = "zones";
export const SECTION_OF = Object.freeze(SECTIONS);

const WORDS = {
  markers: ["подпись", "подписи", "подписей"],
  zones: ["зона", "зоны", "зон"],
};
export const ITEM_WORDS = Object.freeze(WORDS);
export const SET_WORDS = ["набор", "набора", "наборов"];

const SET_PREFIX = "set:";

export function setOfPage(page) {
  if (typeof page !== "string" || !page.startsWith(SET_PREFIX)) return null;
  return page.slice(SET_PREFIX.length);
}

const PICKS = ZONE_PALETTES.filter(({ id }) => id !== "random");
const RANDOM = ZONE_PALETTES.find(({ id }) => id === "random");
const CYRILLIC = /[Ѐ-ӿ]/;
const WRAP = /\s*\n\s*/g;
const SEARCH_FROM = 12;
const WHITE = "#ffffff";
const WIPE = {
  font: "",
  weight: "",
  scale: 100,
  spacing: 0,
  color: "",
  outline: null,
  outlineColor: "",
  caps: false,
};

// ---------- помощники разметки и правок ----------

const node = (name, cls, more, ...kids) => h(name, { className: cls, ...more }, ...kids);
const pressable = (cls, more, ...kids) =>
  h("button", { type: "button", className: cls, ...more }, ...kids);
const ghostButton = (text, onClick) => h(Button, { variant: "ghost", size: "sm", onClick }, text);

// Правка проекта наружу: без свойства — ровно два аргумента.
const emitterOf =
  (onConfig) =>
  (...args) => {
    if (args[2] === undefined) args.length = 2;
    return onConfig(...args);
  };

const styleWriter =
  (env, id, section = env.section) =>
  (patch, label, prop) =>
    env.emit(setMapGroupStyle(env.config, section, id, patch), label, prop);
const labelWriter = (env, id) => (patch, label, prop) =>
  env.emit(setMapGroupLabelStyle(env.config, id, patch), label, prop);

// (поле, подпись, семейство свойства) -> (значение) -> запись; свойство вида group.<семейство>.<id>
const fieldSetter = (write, id) => (name, note, family) => (value) =>
  write({ [name]: value }, tr(note), family ? `group.${family}.${id}` : undefined);

function slider(label, value, [min, max, step], unit, onChange) {
  const props = { label: tr(label), value, min, max, step, onChange };
  if (unit) props.unit = unit;
  return h(Slider, props);
}

function colorBlock(caption, label, value, onChange) {
  return node(
    "div",
    "wmc-field-block",
    null,
    node("small", "wmc-field-caption", null, caption),
    h(Swatches, { label, value, onChange }),
  );
}

// ---------- вид текста набора ----------

const TEXT_PARTS = [
  ({ style, set, title }) =>
    h(LabelFontList, {
      value: style.font,
      emptyLabel: tr("Как у всех подписей"),
      label: mapText("Шрифт набора «{title}»", { title }),
      onChange: set("font", "Шрифт подписей набора"),
    }),
  ({ style, set }) =>
    h(Select, {
      className: "wmc-select",
      label: tr("Начертание"),
      value: style.weight,
      options: labelWeightOptions(),
      onChange: set("weight", "Начертание подписей набора"),
    }),
  ({ style, set }) =>
    slider("Размер", style.scale, [50, 250, 1], "%", set("scale", "Размер подписей набора", "scale")),
  ({ style, set }) =>
    colorBlock(
      tr(style.color ? "Цвет всех подписей" : "Цвет текста · как у всех"),
      tr("Цвет текста набора"),
      style.color,
      set("color", "Цвет подписей набора", "color"),
    ),
  ({ style, write }) =>
    h(CaseChoice, {
      value: style.caps ? "upper" : "as-is",
      onChange: (choice) => {
        const caps = choice === "upper";
        write({ caps }, tr(caps ? "Подписи набора прописными" : "Подписи набора как написаны"));
      },
    }),
  strokePart,
  wipePart,
];

function strokePart({ env, id, sec, style, set }) {
  const level = style.outline ?? sec.labelOutline ?? 0;
  const tint =
    level > 0
      ? node(
          "div",
          "wmc-color-lines",
          null,
          h(ColorLine, {
            label: "Цвет обводки",
            value: style.outlineColor || "#04060a",
            onChange: set("outlineColor", "Цвет обводки подписей набора", "outlineColor"),
          }),
        )
      : null;
  return h(
    Disclosure,
    {
      label: tr("Обводка и разрядка"),
      memoryId: env.memoryId,
      memoryKey: `setstroke:${env.section}:${id}`,
    },
    slider("Обводка", level, [0, 400, 1], null, set("outline", "Обводка подписей набора", "outline")),
    tint,
    slider("Разрядка", style.spacing, [-10, 60, 1], "%", set("spacing", "Разрядка подписей набора", "spacing")),
  );
}

function wipePart({ env, id, style }) {
  const owned =
    [style.font, style.weight, style.spacing, style.color, style.outlineColor, style.caps].some(Boolean) ||
    style.scale !== 100 ||
    style.outline != null;
  if (!owned) return null;
  const reset = () =>
    env.emit(setMapGroupStyle(env.config, env.section, id, { ...WIPE }), tr("Подписи набора как у всех"));
  return ghostButton(tr("Текст как у всех подписей"), reset);
}

function textView(env, id, title) {
  const sec = env.config[env.section];
  const write = (env.section === "markers" ? labelWriter : styleWriter)(env, id);
  const ctx = { env, id, title, sec, style: mapGroupStyle(sec, id), write, set: fieldSetter(write, id) };
  return h(Fragment, null, ...TEXT_PARTS.map((part) => part(ctx)));
}

// ---------- вид набора-сетки донора ----------

function meshView(env, id, items) {
  const style = mapGroupStyle(env.config.markers, id);
  const write = styleWriter(env, id, "markers");
  const set = fieldSetter(write, id);
  const spot = items.find((item) => item.mesh);
  const edits = meshEditCount(spot);
  const authored = style.color || style.outlineColor;
  const editsTail =
    edits > 0
      ? [
          node("small", "wmc-hint", null, mapText("Правлено подписей автора: {count}", { count: edits })),
          ghostButton(tr("Все подписи как у автора"), () =>
            env.emit(restoreAllMeshLabels(env.config, spot), tr("Все подписи как у автора")),
          ),
        ]
      : [];
  return h(
    Fragment,
    null,
    node(
      "small",
      "wmc-hint",
      { "data-mesh-note": true },
      tr(
        "Подписи этой карты — её собственная картинка, один в один, как нарисовал автор. Щёлкните по подписи на карте: её можно перекрасить, спрятать или заменить своим текстом тем же видом. Цвет и обводку можно менять и на весь набор.",
      ),
    ),
    colorBlock(
      tr(style.color ? "Цвет всех подписей" : "Цвет подписей · как у автора"),
      tr("Цвет подписей набора"),
      style.color,
      set("color", "Цвет подписей набора", "color"),
    ),
    colorBlock(
      tr(style.outlineColor ? "Цвет обводки подписей" : "Цвет обводки · как у автора"),
      tr("Цвет обводки набора"),
      style.outlineColor,
      set("outlineColor", "Цвет обводки подписей набора", "outlineColor"),
    ),
    authored
      ? ghostButton(tr("Цвета как у автора"), () =>
          write({ color: "", outlineColor: "" }, tr("Цвета подписей как у автора")),
        )
      : null,
    ...editsTail,
  );
}

// ---------- строки наборов на главной ----------

function meshSample() {
  return node(
    "span",
    "wmc-sets-sample is-labels is-mesh",
    { "aria-hidden": "true", "data-audit-ignore": "type-scale caps" },
    "1:1",
  );
}

function zonesSample(env, group, items) {
  const tones = [...new Set(items.map((item) => item.color))].slice(0, 4);
  return node(
    "span",
    "wmc-sets-sample is-zones",
    { "aria-hidden": "true" },
    ...tones.map((tone) => h("i", { key: tone, style: { background: tone } })),
  );
}

function labelsSample(env, group, items) {
  const markers = env.config.markers;
  const own = mapGroupStyle(markers, group.id);
  const head = items[0];
  const color =
    own.color ||
    head.labelColor ||
    head.color ||
    markers.categories?.[head.category]?.color ||
    markers.labelColor;
  const fontFamily = FONT_FAMILIES[own.font || markers.font] || FONT_FAMILIES.astral;
  return node(
    "span",
    "wmc-sets-sample is-labels",
    { "aria-hidden": "true", "data-audit-ignore": "type-scale caps", style: { color, fontFamily } },
    tr("Аа"),
  );
}

const SAMPLES = [
  [(env, group, items) => items.some((item) => item.mesh), meshSample],
  [(env) => env.section === "zones", zonesSample],
  [() => true, labelsSample],
];

function SetRow({ env, group, items, onPage }) {
  const title = setTitle(group.title);
  const mesh = items.some((item) => item.mesh);
  const caption = mesh
    ? tr("Подписи карты автора, один в один")
    : counted(group.count, trForms(ITEM_WORDS[env.section]));
  const { visible } = group;
  const [, buildSample] = SAMPLES.find(([applies]) => applies(env, group, items));
  const flip = () =>
    env.emit(
      setMapGroupVisible(env.config, env.section, group.id, !visible),
      mapText(visible ? "Набор «{title}» скрыт" : "Набор «{title}» показан", { title }),
    );
  return node(
    "li",
    visible ? "" : "is-hidden",
    { "data-set-row": group.id || "own" },
    pressable(
      "wmc-sets-open",
      {
        "aria-label": mapText("Набор «{title}»: {count}", { title, count: caption }),
        onClick: () => onPage?.(`${SET_PREFIX}${group.id}`),
      },
      buildSample(env, group, items),
      node("span", "wmc-sets-copy", null, h("b", { "data-audit-ignore": "caps" }, title), h("small", null, caption)),
      h(CaretRight),
    ),
    pressable(
      "wmc-eye",
      {
        "aria-pressed": visible,
        "aria-label": mapText(visible ? "Скрыть набор «{title}»" : "Показать набор «{title}»", { title }),
        title: tr(visible ? "Скрыть набор" : "Показать набор"),
        onClick: flip,
      },
      h(visible ? Eye : EyeSlash),
    ),
  );
}

const EMPTY_HINTS = {
  labels:
    "Подписей пока нет. Выберите карту-мод: её подписи встанут на карту так, как нарисовал автор, а цвет и обводку можно менять на весь набор.",
  zones: "Зон пока нет. Территории МЦЛ и зоны GTA 5 RP — готовыми наборами.",
};

function headingOf(kind, filled) {
  if (kind === "labels") return "Набор подписей";
  return filled ? "Добавить" : "Наборы";
}

function HomeScreen({ env, groups, byGroup, catalog, onPage, onNotice, onFocusSet }) {
  useTr();
  const { kind, config, memoryId, onConfig, onSection } = env;
  const labels = kind === "labels";
  const filled = groups.length > 0;
  const standing = labels ? standingLabelGroup(groups) : null;

  const shelf = h(
    PanelSection,
    {
      title: tr(headingOf(kind, filled)),
      icon: h(Stack),
      hint: filled ? null : tr(EMPTY_HINTS[labels ? "labels" : "zones"]),
    },
    catalog ? h(SetsCatalog, { kind, config, onConfig, onNotice, onFocusSet, ...catalog }) : null,
  );

  let chosen = null;
  if (standing) {
    const items = byGroup.get(standing.id) ?? [];
    const body = items.some((item) => item.mesh)
      ? meshView(env, standing.id, items)
      : textView(env, standing.id, setTitle(standing.title));
    chosen = h(PanelSection, { title: tr("Вид выбранного набора"), icon: h(TextAa) }, body);
  }

  let onMap = null;
  if (filled) {
    const rows = groups.map((group) =>
      h(SetRow, { key: group.id || "own", env, group, items: byGroup.get(group.id) ?? [], onPage }),
    );
    onMap = h(
      PanelSection,
      { title: tr("На карте"), icon: h(Stack) },
      node("ul", "wmc-sets-list", { "aria-label": tr(labels ? "Наборы подписей на карте" : "Наборы зон на карте") }, ...rows),
      h(
        Button,
        { variant: "secondary", size: "sm", block: true, icon: h(FloppyDisk), onClick: () => onPage?.("save") },
        tr("Сохранить как свой набор"),
      ),
    );
  }

  const overall = node(
    "section",
    "ui-panel wmc-section wmc-map-section wmc-map-list",
    { "aria-label": tr("Общий вид") },
    h(
      Disclosure,
      {
        label: tr(labels ? "Как выглядят все подписи" : "Как выглядят все зоны"),
        memoryId,
        memoryKey: labels ? "labels:look" : "zones:look",
      },
      labels ? h(LabelsLook, { config, onSection }) : h(ZonesLook, { config, onConfig, onSection }),
    ),
  );
  return h(Fragment, null, shelf, chosen, onMap, overall);
}

// ---------- вид зон набора ----------

function paletteButton(palette, paint) {
  const name = tr(palette.title);
  return pressable(
    "wmc-palette",
    {
      key: palette.id,
      title: name,
      "aria-label": mapText("Раскрасить набор: {name}", { name }),
      onClick: () => paint(palette.id),
    },
    node(
      "span",
      "wmc-palette-strip",
      { "aria-hidden": "true" },
      ...paletteSwatch(palette.id).map((tone, i) => h("i", { key: i, style: { background: tone } })),
    ),
    h("small", null, name),
  );
}

function fillSection(z, paint) {
  const { env, id, items, look, mode, color, line, set } = z;
  const { config, emit } = env;
  const pickFill = (next) => {
    if (next === "none") {
      emit(patchMapGroup(config, "zones", id, { fill: false }), tr("Набор без заливки"));
      return;
    }
    const filled = patchMapGroup(config, "zones", id, { fill: true });
    const note = next === "recolor" ? "Набор перекрашивает карту" : "Набор — плёнкой цвета";
    emit(setMapGroupStyle(filled, "zones", id, { fillMode: next }), tr(note));
  };
  const several = new Set(items.map((item) => item.color)).size > 1;
  const density =
    mode === "none"
      ? null
      : slider(
          look.fillMode === "recolor" ? "Сила перекраски" : "Плотность",
          look.fillOpacity,
          [0, 100, 1],
          "%",
          set("fillOpacity", "Плотность заливки набора", "fillOpacity"),
        );
  const tint = node(
    "div",
    "wmc-color-lines",
    null,
    h(ColorLine, {
      label: several ? "Весь набор одним цветом" : "Цвет набора",
      value: color,
      onChange: (next) =>
        emit(patchMapGroup(config, "zones", id, { color: next, fillColor: null }), tr("Цвет набора"), `group.color.${id}`),
    }),
  );
  const shuffle = RANDOM
    ? h(
        Button,
        { variant: "secondary", size: "sm", block: true, icon: h(Shuffle), onClick: () => paint(RANDOM.id) },
        tr("Случайные цвета"),
      )
    : null;
  return h(
    PanelSection,
    { title: tr("Заливка") },
    h(ZoneSample, { look, line, color, filled: mode !== "none" }),
    h(FillChoice, { label: tr("Заливка зон набора"), value: mode, color, onChange: pickFill }),
    density,
    tint,
    node(
      "div",
      "wmc-palettes",
      { role: "group", "aria-label": tr("Раскрасить набор") },
      ...PICKS.map((palette) => paletteButton(palette, paint)),
    ),
    shuffle,
  );
}

function borderSection(z) {
  const { env, id, look, color, line, style, set } = z;
  const { config, emit } = env;
  const custom =
    Boolean(style.fillMode) ||
    Boolean(style.strokeAlign) ||
    [style.fillOpacity, style.strokeWidth, style.glow].some((value) => value != null);
  const dropAll = () =>
    z.write(
      { fillMode: "", fillOpacity: null, strokeWidth: null, strokeAlign: "", glow: null },
      tr("Набор как все зоны"),
    );
  return h(
    PanelSection,
    { title: tr("Граница") },
    slider("Толщина", look.strokeWidth, [0, 16, 0.1], null, set("strokeWidth", "Граница набора", "strokeWidth")),
    h(AlignChoice, {
      label: tr("Где граница"),
      value: look.strokeAlign,
      color,
      onChange: set("strokeAlign", "Граница набора"),
    }),
    h(LineChoice, {
      label: tr("Линия"),
      value: line,
      color,
      onChange: (next) => emit(patchMapGroup(config, "zones", id, { line: next }), tr("Линия набора")),
    }),
    slider("Свечение", look.glow, [0, 100, 1], "%", set("glow", "Свечение набора", "glow")),
    custom ? ghostButton(tr("Заливка и граница как у всех зон"), dropAll) : null,
  );
}

function ZoneLooks({ env, id, items }) {
  useTr();
  const grain = useRef(1);
  const { config } = env;
  const head = items[0];
  const look = zoneGroupLook(config.zones, id);
  const write = styleWriter(env, id, "zones");
  const z = {
    env,
    id,
    items,
    look,
    write,
    set: fieldSetter(write, id),
    style: mapGroupStyle(config.zones, id),
    mode: items.some((item) => item.fill !== false) ? look.fillMode : "none",
    line: head?.line || "solid",
    color: head?.color || WHITE,
  };
  const paint = (paletteId) => {
    grain.current += 1;
    env.emit(recolorZones(config, paletteId, { group: id, seed: grain.current }), tr("Раскраска набора"));
  };
  return h(Fragment, null, fillSection(z, paint), borderSection(z));
}

// ---------- точки и значки, список «что в наборе» ----------

const hasGlyph = (category) => {
  const glyph = MARKER_CATEGORY_MAP[category]?.glyph;
  return Boolean(glyph) && glyph !== "none";
};

function dotsSection(env, id, items) {
  if (env.section !== "markers") return null;
  const { config, emit } = env;
  const categories = config.markers.categories;
  const dotted = items.filter((item) => item.dot && categories?.[item.category]?.showDot !== false);
  if (dotted.length === 0) return null;
  const first = items[0];
  const tone = first?.color || categories?.[first?.category]?.color || WHITE;
  const set = fieldSetter(styleWriter(env, id, "markers"), id);
  return h(
    PanelSection,
    { title: tr(dotted.some((item) => hasGlyph(item.category)) ? "Значки" : "Точки и круги") },
    slider("Размер", mapGroupStyle(config.markers, id).dotScale, [30, 300, 5], "%", set("dotScale", "Размер точек набора", "dotScale")),
    colorBlock(tr("Цвет"), tr("Цвет точек набора"), tone, (color) =>
      emit(patchMapGroup(config, "markers", id, { color }), tr("Цвет точек набора"), `group.dot.${id}`),
    ),
  );
}

function itemRow(env, item, onSelect) {
  const { section, config, emit } = env;
  const entity = section === "markers" ? "marker" : "zone";
  const enabled = Boolean(item.enabled);
  const { name } = item;
  const tone =
    section === "zones"
      ? item.color
      : item.labelColor || item.color || config.markers.categories?.[item.category]?.color || WHITE;
  const flip = () =>
    emit(patchObject(config, { kind: entity, id: item.id }, { enabled: !item.enabled }), tr(enabled ? "Скрыто" : "Показано"));
  return h(
    "li",
    { key: item.id, className: enabled ? "" : "is-hidden" },
    h("i", { className: "wmc-set-item-dot", "aria-hidden": "true", style: { background: tone } }),
    pressable(
      "wmc-set-item-name",
      {
        title: tr("Открыть на карте"),
        "data-audit-ignore": "caps",
        lang: CYRILLIC.test(name) ? "ru" : undefined,
        onClick: () => onSelect({ kind: entity, id: item.id }),
      },
      String(name).replace(WRAP, " "),
    ),
    pressable(
      "wmc-eye",
      {
        "aria-pressed": enabled,
        "aria-label": mapText(enabled ? "Скрыть «{name}»" : "Показать «{name}»", { name }),
        title: tr(enabled ? "Скрыть" : "Показать"),
        onClick: flip,
      },
      h(enabled ? Eye : EyeSlash),
    ),
  );
}

function ItemsSection({ env, items, onSelect }) {
  useTr();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("ru");
  const matches = (item) => String(item.name).toLocaleLowerCase("ru").includes(needle);
  const shown = needle ? items.filter(matches) : items;
  const finder =
    items.length > SEARCH_FROM
      ? node(
          "label",
          "wmc-sets-search",
          null,
          h(MagnifyingGlass),
          h("input", {
            placeholder: tr("Найти в наборе"),
            "aria-label": tr("Найти в наборе"),
            type: "search",
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
        )
      : null;
  const heading = `${tr(env.section === "markers" ? "Подписи" : "Зоны")} · ${items.length}`;
  return h(
    PanelSection,
    { title: heading },
    finder,
    node(
      "ul",
      "wmc-set-items",
      null,
      ...shown.map((item) => itemRow(env, item, onSelect)),
      shown.length ? null : node("small", "wmc-hint", null, tr("Ничего не нашлось")),
    ),
  );
}

// ---------- экран набора ----------

function SetScreen({ env, group, items, onSelect }) {
  useTr();
  const { kind, section, config, emit } = env;
  const { id } = group;
  if (kind === "labels" && items.some((item) => item.mesh)) {
    return h(PanelSection, { title: tr("Вид набора"), icon: h(TextAa) }, meshView(env, id, items));
  }
  const title = setTitle(group.title);
  const zoned = section === "zones";
  const speaking = items.some((item) => item.label !== false);
  const setLabels = (on) => {
    const patched = patchMapGroup(config, section, id, { label: on });
    const next =
      zoned && on ? normalizeWorldMap({ ...patched, zones: { ...patched.zones, labels: true } }) : patched;
    emit(next, tr(on ? "Подписи набора показаны" : "Подписи набора скрыты"));
  };
  const labelsSwitch = h(Switch, {
    checked: speaking,
    label: mapText("Подписи набора «{title}»", { title }),
    onChange: setLabels,
  });
  const labelsBody = speaking
    ? textView(env, id, title)
    : node("small", "wmc-hint", null, tr("Подписи набора скрыты — значки, точки и зоны остаются."));
  return h(
    Fragment,
    null,
    zoned ? h(ZoneLooks, { env, id, items }) : null,
    h(
      PanelSection,
      { title: tr(zoned ? "Подписи зон" : "Текст"), icon: h(TextAa), actions: labelsSwitch },
      labelsBody,
    ),
    dotsSection(env, id, items),
    h(ItemsSection, { env, items, onSelect }),
  );
}

// ---------- сам инструмент ----------

function frame(kind, screen, ...parts) {
  return node("div", "wmc-sets-tool", { "data-sets-tool": kind, "data-page": screen }, ...parts);
}

function route(page, groups) {
  const saving = saveOfPage(page);
  if (saving && groups.length) {
    const known = saving.group !== null && groups.some(({ id }) => id === saving.group);
    return { screen: "save", from: known ? saving.group : null };
  }
  const wanted = setOfPage(page);
  const group = wanted === null ? undefined : groups.find(({ id }) => id === wanted);
  return group ? { screen: "set", group } : { screen: "home" };
}

export default function MapSetsTool(props) {
  const { kind, config, onConfig, onSection, onSelect, onPage } = props;
  const { page = "home", memoryId = "", catalog = null, onNotice = null, onFocusSet = null } = props;
  const section = SECTION_OF[kind];
  const groups = useMemo(() => mapGroups(config, section), [config, section]);
  const byGroup = useMemo(() => {
    const table = new Map();
    for (const item of config?.[section]?.items ?? []) {
      const slot = table.get(item.group || "");
      if (slot) slot.push(item);
      else table.set(item.group || "", [item]);
    }
    return table;
  }, [config, section]);
  const env = { kind, section, config, memoryId, onConfig, onSection };
  env.emit = emitterOf(onConfig);

  const next = route(page, groups);
  if (next.screen === "save") {
    const { from } = next;
    const done = () => onPage?.(from ? `${SET_PREFIX}${from}` : "home");
    return frame(kind, "save", h(SaveSetPage, { key: page, kind, section, config, from, onNotice, onDone: done }));
  }
  if (next.screen === "set") {
    const items = byGroup.get(next.group.id) ?? [];
    return frame(kind, "set", h(SetScreen, { env, group: next.group, items, onSelect }));
  }
  return frame(kind, "home", h(HomeScreen, { env, groups, byGroup, catalog, onPage, onNotice, onFocusSet }));
}
