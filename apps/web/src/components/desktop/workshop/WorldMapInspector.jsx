import { createElement as h, Fragment } from "react";
import { ArrowCounterClockwise, CaretRight } from "../../ui/icons.jsx";
import {
  MARKER_CATEGORY_MAP,
  ZONE_SHAPES,
  isUserGroup,
  mapGroupFactory,
  mapGroupStyle,
  mapGroupTitle,
  zoneStyleOf,
} from "@modovik/vector-map";
import Button from "../../ui/Button.jsx";
import ColorPicker from "../../ui/ColorPicker.jsx";
import Select from "../../ui/Select.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import Slider from "../../ui/Slider.jsx";
import { ImagesPanel, TextPanel } from "./WorldMapEmblemPanels.jsx";
import MapSchedule from "./world-map/MapSchedule.jsx";
import { ShapePicker } from "./WorldMapShapes.jsx";
import MapMarkerGrid from "./world-map/MapMarkerGrid.jsx";
import { ColorLine, Disclosure } from "./world-map/MapPanelParts.jsx";
import { LineChoice } from "./world-map/MapLookPictures.jsx";
import { BrushDemo, EraserDemo, MarkerDemo, ShapeDemo } from "./world-map/MapToolDemo.jsx";
import { labelWeightOptions } from "./world-map/label-options.js";
import LabelFontList from "./world-map/MapLabelFonts.jsx";
import { useMapMemory } from "./world-map-memory.js";
import {
  ObjectActions,
  ObjectRow,
  Section,
  Swatches,
  TextRow,
  Toggle,
} from "./world-map-panel-parts.jsx";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { lowerFor, mapText, setTitle } from "./world-map/map-copy.js";

/* ---------- данные ---------- */

// Подставляются только вместо undefined: null остаётся как есть.
const FALLBACKS = {
  markerLabel: "",
  onMarkerLabel: null,
  onPhoto: null,
  onScheduleImage: null,
  onScheduleHide: null,
  onFitZone: null,
  shapeTool: null,
  onShapeTool: null,
  onReshape: null,
  onZoneBox: null,
  textStyle: null,
  onTextStyle: null,
  onFontFile: null,
  onBrush: null,
  brushMode: "free",
  onArrowBoth: null,
  eraserSize: 160,
  onEraserSize: null,
  memoryId: "",
  onOpenSet: null,
  zoneNames: null,
};

// Русские подписи переводятся в месте отрисовки.
const LINE_NAMES = { solid: "Сплошная", dashed: "Пунктир", dotted: "Точки" };
const SIZE_STEPS = [
  [70, "Мелкий"],
  [100, "Обычный"],
  [150, "Крупный"],
];
const CASE_STEPS = [
  ["inherit", "Как у набора"],
  ["upper", "АБВ"],
  ["plain", "Абв"],
];
const CASE_FLAGS = { inherit: null, upper: true, plain: false };

const BOX_FIELDS = [
  { field: "w", title: "Ширина", note: "Ширина фигуры", min: 40, max: 20000, step: 10 },
  { field: "h", title: "Высота", note: "Высота фигуры", min: 40, max: 20000, step: 10 },
  { field: "rotation", title: "Поворот", note: "Поворот фигуры", min: -180, max: 180, unit: "°" },
];
const OFFSET_AXES = [
  ["x", "Подпись по горизонтали"],
  ["y", "Подпись по вертикали"],
];

// Блок кириллицы U+0400–U+04FF: в него входят и украинские, и сербские буквы.
const CYRILLIC_FIRST = 0x400;
const CYRILLIC_LAST = 0x4ff;
const ENDS_WITH_NUMBER = /\d\s*$/;

const onlyBoolean = (value) => (typeof value === "boolean" ? value : undefined);

/* ---------- мелкие чистые помощники ---------- */

const when = (condition, make) => (condition ? make() : null);

function settle(props) {
  const ctx = { ...props };
  for (const name of Object.keys(FALLBACKS)) {
    if (ctx[name] === undefined) ctx[name] = FALLBACKS[name];
  }
  if (ctx.fonts === undefined) ctx.fonts = [];
  return ctx;
}

function hasCyrillic(text) {
  for (const symbol of String(text)) {
    const code = symbol.codePointAt(0);
    if (code >= CYRILLIC_FIRST && code <= CYRILLIC_LAST) return true;
  }
  return false;
}

function sizeStep(scale) {
  if (scale < 85) return 70;
  return scale > 125 ? 150 : 100;
}

function caseStep(caps) {
  if (caps === true) return "upper";
  return caps === false ? "plain" : "inherit";
}

function shapeLabel(id) {
  if (id === "free") return tr("Своя фигура");
  const entry = ZONE_SHAPES.find((shape) => shape.id === id);
  return entry ? tr(entry.label) : "";
}

function zoneNote(zone) {
  const shape = zone.shape || "free";
  if (shape !== "free") return shapeLabel(shape);
  const count = zone.points.length;
  return zone.hint
    ? mapText("{count} вершин · {hint}", { count, hint: zone.hint })
    : mapText("{count} вершин", { count });
}

function flipEnabled(items, id) {
  return items.map((entry) => (entry.id === id ? { ...entry, enabled: !entry.enabled } : entry));
}

// Свой вид подписи: хоть одно поле отличается от «как у набора».
function hasOwnLook(marker) {
  const named = marker.font || marker.weight || marker.labelColor || marker.labelOutlineColor;
  if (named) return true;
  return (marker.labelScale ?? 100) !== 100 || marker.labelOutline != null || marker.caps != null;
}

function plainLook() {
  return {
    font: "",
    weight: "",
    labelColor: null,
    labelScale: 100,
    labelOutline: null,
    labelOutlineColor: null,
    caps: null,
  };
}

// «Заводской» значок набора: запись может отдавать список или объект со списком.
function factoryMarker(marker, names) {
  if (!marker.group || isUserGroup(marker.group)) return null;
  const record = mapGroupFactory("markers", marker.group, { names });
  const list = Array.isArray(record) ? record : (record?.items ?? record?.markers);
  return list?.find((entry) => entry.id === marker.id) ?? null;
}

function strayedFrom(marker, origin) {
  if (marker.name !== origin.name) return true;
  if (Math.round(marker.x) !== Math.round(origin.x)) return true;
  if (Math.round(marker.y) !== Math.round(origin.y)) return true;
  if (hasOwnLook(marker)) return true;
  if ((marker.color || null) !== (origin.color || null)) return true;
  return Boolean(marker.label) !== (origin.label !== false);
}

/* ---------- обратные вызовы окна ---------- */

// Одно поле выбранного объекта: onObject(патч, подпись, свойство).
function writer(ctx, key, note, path) {
  const { onObject } = ctx;
  return (value) => onObject({ [key]: value }, note, path);
}

function rowHandlers(ctx, kind, id) {
  const { onSelect, onFocus, onRemove } = ctx;
  const target = () => ({ kind, id });
  return {
    onSelect: () => onSelect(target()),
    onFocus: () => onFocus(target()),
    onRemove: () => onRemove(target()),
  };
}

function chosenOf(ctx, kind) {
  const { selection, selected } = ctx;
  return selection?.kind === kind && Boolean(selected);
}

/* ---------- блоки, общие для нескольких разделов ---------- */

function setLink(ctx, item, section) {
  const { config, onOpenSet } = ctx;
  const group = item.group;
  if (!group || isUserGroup(group) || !onOpenSet) return null;
  const caption =
    section === "zones"
      ? tr("Заливка, граница и цвет всех зон набора")
      : tr("Шрифт, размер и цвет всех подписей набора");
  const title = setTitle(mapGroupTitle(group, config[section].groupTitles));
  return h(
    Button,
    {
      variant: "ghost",
      block: true,
      className: "wmc-nav-row wmc-set-link",
      caption,
      trailing: h(CaretRight, { "aria-hidden": "true" }),
      onClick: () => onOpenSet(section, group),
    },
    mapText("Набор «{title}»", { title }),
  );
}

function headerActions(ctx) {
  const { onDuplicate, onRemove } = ctx;
  return h(ObjectActions, { onDuplicate, onRemove });
}

function objectList(rows) {
  return h("ul", { className: "wmc-object-list" }, rows);
}

/* ---------- выбранная зона ---------- */

function zoneSection(ctx) {
  const { selected: zone, config, language, onObject, onReshape, onZoneBox } = ctx;
  const filled = zone.fill !== false;

  const boxRows = zone.box
    ? BOX_FIELDS.map(({ field, title, note, min, max, step, unit }) =>
        h(Slider, {
          label: tr(title),
          value: zone.box[field],
          min,
          max,
          step,
          unit,
          onChange: (value) => onZoneBox?.({ [field]: value }, tr(note)),
        }),
      )
    : [];

  const offsetRows = zone.label
    ? OFFSET_AXES.map(([axis, title]) =>
        h(Slider, {
          label: tr(title),
          value: zone.labelOffset[axis],
          min: -1500,
          max: 1500,
          step: 10,
          onChange: (value) =>
            onObject(
              { labelOffset: { ...zone.labelOffset, [axis]: value } },
              tr("Сдвинута подпись зоны"),
              "zone.labelOffset",
            ),
        }),
      )
    : [];

  return h(
    Section,
    {
      title: tr("Выбранная зона"),
      hint: zone.box
        ? tr("Тяните углы рамки на карте — размер, кружок сверху — поворот, Shift — ровно")
        : tr("Тяните вершины на карте. Shift + клик по границе добавляет вершину, Alt + клик убирает"),
      actions: headerActions(ctx),
    },
    setLink(ctx, zone, "zones"),
    h(TextRow, {
      label: tr("Название"),
      value: zone.name,
      onChange: writer(ctx, "name", tr("Переименована зона"), "zone.name"),
    }),
    h(TextRow, {
      label: tr("Подсказка"),
      value: zone.hint || "",
      maxLength: 64,
      placeholder: tr("Кому принадлежит, что тут происходит"),
      onChange: writer(ctx, "hint", tr("Подсказка зоны"), "zone.hint"),
    }),
    h(Swatches, {
      label: tr("Цвет зоны"),
      value: zone.color,
      onChange: writer(ctx, "color", tr("Изменён цвет зоны"), "zone.color"),
    }),
    h(ShapePicker, {
      compact: true,
      free: false,
      shape: zone.shape || "free",
      style: zoneStyleOf(zone),
      onShape: (shape) => onReshape?.(shape),
      onStyle: ({ line, fill, label }) =>
        onObject(
          { line, fill },
          mapText("Линия зоны: {line}", { line: lowerFor(language, label) }),
          "zone.style",
        ),
    }),
    h(LineChoice, {
      label: tr("Линия границы"),
      value: zone.line || "solid",
      color: zone.color,
      onChange: writer(ctx, "line", tr("Линия зоны"), "zone.line"),
    }),
    h(Toggle, {
      label: tr("Заливка"),
      checked: filled,
      onChange: writer(ctx, "fill", tr("Заливка зоны"), "zone.fill"),
    }),
    when(filled, () =>
      h(Swatches, {
        label: tr("Цвет заливки"),
        value: zone.fillColor || zone.color,
        onChange: writer(ctx, "fillColor", tr("Цвет заливки зоны"), "zone.fillColor"),
      }),
    ),
    when(filled && zone.fillColor, () =>
      h(
        Button,
        {
          variant: "ghost",
          size: "sm",
          onClick: () =>
            onObject({ fillColor: null }, tr("Заливка цветом границы"), "zone.fillColor"),
        },
        tr("Заливка цветом границы"),
      ),
    ),
    h(Slider, {
      label: tr("Толщина линии"),
      value: zone.width ?? config.zones.strokeWidth,
      min: 0,
      max: 24,
      step: 0.1,
      onChange: writer(ctx, "width", tr("Толщина линии зоны"), "zone.width"),
    }),
    when(zone.width != null, () =>
      h(
        Button,
        {
          variant: "ghost",
          size: "sm",
          onClick: () => onObject({ width: null }, tr("Толщина как у всех зон"), "zone.width"),
        },
        tr("Толщина как у всех зон"),
      ),
    ),
    ...boxRows,
    h(Toggle, {
      label: tr("Подпись зоны"),
      checked: zone.label,
      onChange: writer(ctx, "label", tr("Подпись зоны"), "zone.label"),
    }),
    ...offsetRows,
  );
}

/* ---------- выбранный значок или подпись ---------- */

function markerLookRows(ctx, marker, bare) {
  const { config, onObject } = ctx;
  const groupLook = mapGroupStyle(config.markers, marker.group);
  const entry = config.markers.categories?.[marker.category];
  const outline = marker.labelOutline ?? groupLook.outline ?? config.markers.labelOutline ?? 0;
  const caption = bare ? tr("Цвет текста") : tr("Цвет подписи");
  const tint =
    marker.labelColor ||
    marker.color ||
    entry?.labelColor ||
    entry?.color ||
    config.markers.labelColor;

  return [
    h(LabelFontList, {
      value: marker.font,
      emptyLabel: tr("Как у набора"),
      label: tr("Шрифт подписи"),
      onChange: writer(ctx, "font", tr("Шрифт подписи"), "marker.font"),
    }),
    h(Select, {
      className: "wmc-select",
      label: tr("Начертание"),
      ariaLabel: tr("Начертание подписи"),
      value: marker.weight,
      options: labelWeightOptions(),
      onChange: writer(ctx, "weight", tr("Начертание подписи"), "marker.weight"),
    }),
    h(Slider, {
      label: tr("Размер"),
      ariaLabel: tr("Размер подписи"),
      value: marker.labelScale,
      min: 10,
      max: 300,
      step: 5,
      unit: "%",
      onChange: writer(ctx, "labelScale", tr("Размер подписи"), "marker.labelScale"),
    }),
    when(bare, () =>
      h(Slider, {
        label: tr("Поворот"),
        ariaLabel: tr("Поворот подписи"),
        value: marker.rotation,
        min: -180,
        max: 180,
        unit: "°",
        onChange: writer(ctx, "rotation", tr("Поворот подписи"), "marker.rotation"),
      }),
    ),
    h(
      "div",
      { className: "wmc-field-block" },
      h("small", { className: "wmc-field-caption" }, caption),
      h(Swatches, {
        label: caption,
        value: tint,
        onChange: writer(ctx, "labelColor", tr("Цвет подписи"), "marker.labelColor"),
      }),
    ),
    h(SegmentedControl, {
      size: "sm",
      label: tr("Регистр"),
      value: caseStep(marker.caps),
      options: CASE_STEPS.map(([value, name]) => ({ value, label: tr(name) })),
      onChange: (picked) =>
        onObject({ caps: CASE_FLAGS[picked] }, tr("Регистр подписи"), "marker.caps"),
    }),
    h(Slider, {
      label: tr("Обводка"),
      ariaLabel: tr("Обводка подписи"),
      value: outline,
      min: 0,
      max: 400,
      step: 1,
      onChange: writer(ctx, "labelOutline", tr("Обводка подписи"), "marker.labelOutline"),
    }),
    when(outline > 0, () =>
      h(
        "div",
        { className: "wmc-color-lines" },
        h(ColorLine, {
          label: tr("Цвет обводки"),
          value: marker.labelOutlineColor || groupLook.outlineColor || "#04060a",
          onChange: writer(
            ctx,
            "labelOutlineColor",
            tr("Цвет обводки подписи"),
            "marker.labelOutlineColor",
          ),
        }),
      ),
    ),
    when(hasOwnLook(marker), () =>
      h(
        Button,
        {
          variant: "ghost",
          size: "sm",
          onClick: () => onObject(plainLook(), tr("Подпись как у набора"), "marker.labelStyle"),
        },
        tr("Вид как у набора"),
      ),
    ),
  ];
}

function markerResetButton(ctx, marker) {
  const { zoneNames, onObject } = ctx;
  const origin = factoryMarker(marker, zoneNames);
  if (!origin || !strayedFrom(marker, origin)) return null;
  const restored = () => ({
    name: origin.name,
    x: origin.x,
    y: origin.y,
    color: origin.color || null,
    label: origin.label !== false,
    font: "",
    weight: "",
    labelColor: null,
    labelScale: 100,
    labelOutline: null,
    labelOutlineColor: null,
    rotation: origin.rotation || 0,
    caps: null,
  });
  return h(
    Button,
    {
      variant: "ghost",
      size: "sm",
      icon: h(ArrowCounterClockwise),
      onClick: () => onObject(restored(), tr("Подпись — как в наборе"), "marker.reset"),
    },
    tr("Вернуть как было в наборе"),
  );
}

function markerSection(ctx, withType) {
  const { selected: marker, config, memoryId, gridOpen, toggleGrid, onObject } = ctx;
  const bare = MARKER_CATEGORY_MAP[marker.category]?.glyph === "none";
  const entry = config.markers.categories?.[marker.category];

  const nameField = h(
    "label",
    { className: "ui-field wmc-text is-block" },
    h("span", null, bare ? tr("Текст") : tr("Подпись")),
    h("textarea", {
      "data-audit-ignore": "caps",
      lang: hasCyrillic(marker.name) ? "ru" : undefined,
      rows: Math.min(3, marker.name.split("\n").length),
      maxLength: 64,
      value: marker.name,
      onChange: (event) =>
        onObject({ name: event.target.value }, tr("Переименована метка"), "marker.name"),
    }),
  );

  const iconRows = bare
    ? []
    : [
        when(withType, () =>
          h(MapMarkerGrid, {
            label: tr("Значок"),
            value: marker.category,
            open: gridOpen,
            onToggle: toggleGrid,
            onChange: writer(ctx, "category", tr("Значок метки"), "marker.category"),
          }),
        ),
        h(Swatches, {
          label: tr("Цвет значка"),
          value: marker.color || entry?.color || "#ffffff",
          onChange: writer(ctx, "color", tr("Цвет метки"), "marker.color"),
        }),
        h(SegmentedControl, {
          size: "sm",
          label: tr("Размер"),
          value: sizeStep(marker.scale),
          options: SIZE_STEPS.map(([value, name]) => ({ value, label: tr(name) })),
          onChange: writer(ctx, "scale", tr("Размер метки"), "marker.scale"),
        }),
      ];

  let lookRows = [];
  if (marker.label) {
    lookRows = bare
      ? markerLookRows(ctx, marker, bare)
      : [
          h(
            Disclosure,
            { label: tr("Шрифт и вид подписи"), memoryId, memoryKey: "labelstyle:icon" },
            ...markerLookRows(ctx, marker, bare),
          ),
        ];
  }

  return h(
    Section,
    {
      title: bare ? tr("Выбранная подпись") : tr("Выбранный значок"),
      actions: headerActions(ctx),
    },
    setLink(ctx, marker, "markers"),
    nameField,
    ...iconRows,
    h(Toggle, {
      label: tr("Подпись на карте"),
      checked: marker.label,
      onChange: writer(ctx, "label", tr("Подпись метки"), "marker.label"),
    }),
    ...lookRows,
    markerResetButton(ctx, marker),
  );
}

/* ---------- выбранный мазок ---------- */

function strokeSection(ctx) {
  const { selected: stroke } = ctx;
  return h(
    Section,
    { title: tr("Выбранный мазок"), actions: headerActions(ctx) },
    h(TextRow, {
      label: tr("Название"),
      value: stroke.name,
      onChange: writer(ctx, "name", tr("Переименован мазок"), "stroke.name"),
    }),
    h(
      "div",
      { className: "wmc-color-line" },
      h(ColorPicker, {
        label: tr("Цвет"),
        value: stroke.color,
        onChange: writer(ctx, "color", tr("Цвет мазка"), "stroke.color"),
      }),
      h("span", null, tr("Цвет")),
    ),
    h(Slider, {
      label: tr("Толщина"),
      value: stroke.size,
      min: 4,
      max: 4000,
      step: 2,
      unit: tr(" м"),
      onChange: writer(ctx, "size", tr("Толщина мазка"), "stroke.size"),
    }),
    h(Slider, {
      label: tr("Плотность"),
      value: stroke.opacity,
      min: 0,
      max: 100,
      unit: "%",
      onChange: writer(ctx, "opacity", tr("Плотность мазка"), "stroke.opacity"),
    }),
    h(LineChoice, {
      label: tr("Линия"),
      value: stroke.line || "solid",
      color: stroke.color,
      onChange: writer(ctx, "line", tr("Линия мазка"), "stroke.line"),
    }),
  );
}

/* ---------- панели инструментов ---------- */

function strokeList(ctx) {
  const { config, language, selection, onSection } = ctx;
  const strokes = config.paint.items;
  const rows = strokes.map((stroke) =>
    h(ObjectRow, {
      key: stroke.id,
      item: stroke,
      active: selection?.kind === "stroke" && selection.id === stroke.id,
      swatch: stroke.color,
      subtitle: mapText("{size} м · {line}", {
        size: stroke.size,
        line: lowerFor(language, tr(LINE_NAMES[stroke.line || "solid"])),
      }),
      onToggle: () =>
        onSection(
          { paint: { ...config.paint, items: flipEnabled(strokes, stroke.id) } },
          stroke.enabled ? tr("Мазок скрыт") : tr("Мазок показан"),
        ),
      ...rowHandlers(ctx, "stroke", stroke.id),
    }),
  );
  return h(
    Section,
    {
      title: mapText("Мазки · {count}", { count: strokes.length }),
      hint: strokes.length ? null : tr("Пока ни одного мазка. Ведите мышью по карте."),
    },
    objectList(rows),
  );
}

function brushPanel(ctx) {
  const { config, brushMode, onBrush, onArrowBoth } = ctx;
  const brush = config.paint.brush;
  const arrowed = brushMode === "arrow" || brushMode === "arrows";
  const tune = (key) => (value) => onBrush?.({ [key]: value });
  const percent = (title, key) =>
    h(Slider, {
      label: tr(title),
      value: brush[key],
      min: 0,
      max: 100,
      unit: "%",
      onChange: tune(key),
    });

  const drawing = h(
    Section,
    {
      title: tr("Линия и цвет"),
      hint:
        brushMode === "free"
          ? tr("Ведите мышью по карте — линия сглаживается и ложится кривыми, гладко на любом приближении и в игре")
          : tr("Тяните мышью от начала до конца — получится прямая. Shift прижимает её к 45°"),
    },
    when(arrowed, () =>
      h(Toggle, {
        label: tr("Две стрелки"),
        checked: brushMode === "arrows",
        onChange: (both) => onArrowBoth?.(both),
      }),
    ),
    h(BrushDemo, { brush }),
    h(LineChoice, {
      label: tr("Линия"),
      value: brush.line || "solid",
      color: brush.color,
      onChange: tune("line"),
    }),
    h(Swatches, { label: tr("Цвет"), value: brush.color, onChange: tune("color") }),
    h(Slider, {
      label: tr("Толщина"),
      value: brush.size,
      min: 4,
      max: 1200,
      step: 2,
      unit: tr(" м"),
      onChange: tune("size"),
    }),
    percent("Плотность", "opacity"),
    percent("Сглаживание", "smoothing"),
    percent("Мягкость края", "softness"),
    h(Toggle, {
      label: tr("Поверх подписей"),
      checked: brush.target === "top",
      onChange: (onTop) => onBrush?.({ target: onTop ? "top" : "map" }),
    }),
  );

  return h(
    Fragment,
    null,
    drawing,
    when(chosenOf(ctx, "stroke"), () => strokeSection(ctx)),
    strokeList(ctx),
  );
}

function eraserPanel(ctx) {
  const { eraserSize, onEraserSize } = ctx;
  return h(
    Section,
    {
      title: tr("Ластик"),
      hint: tr(
        "Проведите по карте — значки, надписи, картинки и мазки, которых коснулся ластик, удалятся. Фигуру и зону — проведите по её границе. Отменить — Ctrl+Z",
      ),
    },
    h(EraserDemo, { size: eraserSize }),
    h(Slider, {
      label: tr("Толщина"),
      value: eraserSize,
      min: 8,
      max: 4000,
      step: 2,
      unit: tr(" м"),
      onChange: (size) => onEraserSize?.(size),
    }),
  );
}

function newShapeSection(ctx) {
  const { config, shapeTool, onShapeTool } = ctx;
  const tool = shapeTool || {};
  const color = tool.color || "";
  const width = tool.width ?? config.zones.strokeWidth;
  const hint =
    tool.shape === "free"
      ? tr("Ставьте вершины по карте, щелчок по первой или двойной щелчок замыкает")
      : mapText("{shape}: растяните по карте или щёлкните — встанет обычного размера. Shift — ровно", {
          shape: shapeLabel(tool.shape),
        });

  return h(
    Section,
    { title: tr("Новая фигура"), hint },
    h(ShapeDemo, {
      shape: tool.shape,
      line: tool.line,
      fill: tool.fill !== false,
      color,
      width,
    }),
    h(ShapePicker, {
      free: true,
      shape: tool.shape,
      style: zoneStyleOf(tool),
      onShape: (shape) => onShapeTool?.({ shape }),
      onStyle: ({ line, fill }) => onShapeTool?.({ line, fill }),
    }),
    h(Swatches, {
      label: tr("Цвет новой фигуры"),
      value: color,
      onChange: (picked) => onShapeTool?.({ color: picked }),
    }),
    h(Slider, {
      label: tr("Толщина линии"),
      value: width,
      min: 0,
      max: 24,
      step: 0.1,
      onChange: (value) => onShapeTool?.({ width: value }),
    }),
  );
}

function zoneList(ctx) {
  const { config, selection, onSection } = ctx;
  const own = config.zones.items.filter((zone) => !zone.group || isUserGroup(zone.group));
  const rows = own.map((zone) =>
    h(ObjectRow, {
      key: zone.id,
      item: zone,
      active: selection?.kind === "zone" && selection.id === zone.id,
      swatch: zone.color,
      subtitle: zoneNote(zone),
      onToggle: () =>
        onSection(
          { zones: { ...config.zones, items: flipEnabled(config.zones.items, zone.id) } },
          zone.enabled ? tr("Зона скрыта") : tr("Зона показана"),
        ),
      ...rowHandlers(ctx, "zone", zone.id),
    }),
  );
  return h(
    Section,
    {
      title: mapText("Фигуры · {count}", { count: own.length }),
      hint: own.length
        ? null
        : tr("Пока ни одной фигуры. Растяните фигуру по карте или щёлкните — встанет обычного размера."),
    },
    objectList(rows),
  );
}

function zonesPanel(ctx) {
  const lead = chosenOf(ctx, "zone") ? zoneSection(ctx) : newShapeSection(ctx);
  return h(Fragment, null, lead, zoneList(ctx));
}

function markersPanel(ctx) {
  const { markerCategory, markerLabel, onMarkerCategory, onMarkerLabel, onAddMarker } = ctx;
  const { gridOpen, toggleGrid } = ctx;
  const placeholder = tr(MARKER_CATEGORY_MAP[markerCategory]?.title || "Название точки");
  const numbered = ENDS_WITH_NUMBER.test(markerLabel);

  const placing = h(
    Section,
    {
      title: tr("Поставить значок"),
      hint: tr("Выберите значок, впишите подпись и щёлкайте по карте — Esc закончит. «+» — все значки"),
    },
    h(MarkerDemo, { category: markerCategory, label: markerLabel }),
    h(MapMarkerGrid, {
      label: tr("Значок"),
      value: markerCategory,
      open: gridOpen,
      onToggle: toggleGrid,
      onChange: (category) => {
        onMarkerCategory?.(category);
        onAddMarker();
      },
    }),
    h(TextRow, {
      label: tr("Подпись"),
      value: markerLabel,
      placeholder,
      onChange: (text) => onMarkerLabel?.(text),
    }),
    h(
      "small",
      { className: "wmc-hint" },
      numbered
        ? tr("Номер в конце подписи растёт с каждым поставленным значком")
        : tr("Пусто — значок назовётся своей категорией. Номер в конце подписи будет расти сам"),
    ),
  );

  return h(
    Fragment,
    null,
    placing,
    when(chosenOf(ctx, "marker"), () => markerSection(ctx, false)),
  );
}

/* ---------- надписи, картинки, табло ---------- */

function emblemProps(ctx) {
  const { config, atlas, selection, selected } = ctx;
  const { onObject, onSection, onSelect, onFocus, onRemove, onDuplicate } = ctx;
  return {
    config,
    atlas,
    selection,
    selected,
    onObject,
    onSection,
    onSelect,
    onFocus,
    onRemove,
    onDuplicate,
  };
}

function textPanel(ctx) {
  const { textStyle, onTextStyle, fonts, onFontFile } = ctx;
  return h(TextPanel, { ...emblemProps(ctx), textStyle, onTextStyle, fonts, onFontFile });
}

function scheduleBoard(ctx) {
  const { selected, onObject, onFocus, onRemove, onDuplicate } = ctx;
  const { onScheduleImage, onScheduleHide } = ctx;
  return h(MapSchedule, {
    emblem: selected,
    onObject,
    onImage: onScheduleImage,
    onFocus,
    onRemove,
    onDuplicate,
    onHide: onScheduleHide,
  });
}

function picturePanel(ctx) {
  const { onPhoto, onEmblemImage, onFitZone } = ctx;
  return h(ImagesPanel, { ...emblemProps(ctx), onPhoto, onEmblemImage, onFitZone });
}

function imagesPanel(ctx) {
  const { selected } = ctx;
  return chosenOf(ctx, "emblem") && selected.schedule ? scheduleBoard(ctx) : picturePanel(ctx);
}

function emblemSection(ctx) {
  const { selected } = ctx;
  if (selected.kind === "text") return textPanel(ctx);
  return selected.schedule ? scheduleBoard(ctx) : picturePanel(ctx);
}

/* ---------- выбор раздела ---------- */

const BY_KIND = {
  zone: zoneSection,
  marker: (ctx) => markerSection(ctx, true),
  stroke: strokeSection,
  emblem: emblemSection,
};

function selectedPanel(ctx) {
  const { selected, selection } = ctx;
  if (!selected) return null;
  const build = Object.hasOwn(BY_KIND, selection.kind) ? BY_KIND[selection.kind] : null;
  return build ? build(ctx) : null;
}

const PANELS = {
  select: selectedPanel,
  brush: brushPanel,
  eraser: eraserPanel,
  zones: zonesPanel,
  markers: markersPanel,
  text: textPanel,
  images: imagesPanel,
};

export default function WorldMapInspector(props) {
  useTr();
  const language = useUiLanguage();
  const ctx = settle(props);
  const [gridOpen, setGridOpen] = useMapMemory(ctx.memoryId, "markerGridOpen", false, onlyBoolean);
  ctx.language = language;
  ctx.gridOpen = gridOpen;
  ctx.toggleGrid = () => setGridOpen((open) => !open);
  return Object.hasOwn(PANELS, ctx.panel) ? PANELS[ctx.panel](ctx) : null;
}
