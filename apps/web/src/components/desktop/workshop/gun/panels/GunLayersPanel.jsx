import { createElement, Fragment } from "react";

import ColourEffectField from "../../../../../features/workshop/colour-effects/ColourEffectField.jsx";
import SectionHeading from "../../../../../features/workshop/section-help.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import { GLOW_GAME_MODES } from "@modovik/gun-studio";
import { BlendSelect, TextFontSelect } from "./GunLayerControls.jsx";
import * as Glyph from "../../../../ui/icons.jsx";
import MenuButton from "../../../../ui/MenuButton.jsx";
import ColorField from "../../../../ui/ColorField.jsx";
import LayerList from "../../../../ui/LayerList.jsx";
import TextField from "../../../../ui/TextField.jsx";
import Checkbox from "../../../../ui/Checkbox.jsx";
import { fill, trKey, trValues, weaponNoun } from "../gun-copy.js";
import Button from "../../../../ui/Button.jsx";
import Slider from "../../../../ui/Slider.jsx";
import { gunPartName } from "../part-names.js";

const h = createElement;

/** Узел только при истинном условии; иначе null, и React ничего не рисует. */
const when = (test, node) => (test ? node : null);

// ───────── детали модели ─────────

function partRow(material) {
  const { title, source } = gunPartName(material.name);
  const size = `${material.width}×${material.height}`;
  const stacked = material.layers.length;
  return {
    id: material.name,
    title,
    meta: stacked ? `${size} · ${stacked}` : size,
    tooltip: source || undefined,
    thumb: h(Glyph.Cube),
  };
}

function PartsSection({ noun, materials, active, onPick }) {
  const heading = fill(tr("Детали {of}"), { of: noun.of });
  const list = h(LayerList, {
    className: "gun-materials",
    role: "tablist",
    label: heading,
    items: materials.map(partRow),
    value: active,
    onSelect: onPick,
  });
  return h("section", { className: "ui-panel gun-panel" }, h("h2", null, heading), list);
}

// ───────── стопка слоёв ─────────

function kindName(kind) {
  return KIND_NAMES.get(kind) ?? KIND_NAMES.get("paint");
}

function stackRow(layer) {
  const id = layer.id;
  const notes = [layer.visible ? tr(kindName(layer.kind)) : tr("скрыт")];
  if (layer.clip) notes.push(tr("обтравка"));
  return {
    id,
    title: layer.name,
    meta: notes.join(" · "),
    thumb: h(KIND_GLYPHS.get(layer.kind) ?? Glyph.PaintBrush),
  };
}

function toolButton(id, label, glyph, onClick, flags = {}) {
  return { id, label: tr(label), icon: h(glyph), disabled: false, danger: false, ...flags, onClick };
}

/** Значки одной строки: считаются при каждой отрисовке, у каждой строки свои. */
function rowTools(layer, index, total, commands) {
  const id = layer.id;
  const shown = Boolean(layer.visible);
  const eye = shown ? [trKey("Скрыть слой"), Glyph.Eye] : [trKey("Показать слой"), Glyph.EyeSlash];
  const last = index === total - 1;
  return [
    toolButton("visibility", ...eye, () => commands.patch(id, { visible: !shown })),
    toolButton("up", trKey("Поднять слой"), Glyph.ArrowUp, () => commands.move(id, -1), { disabled: index === 0 }),
    toolButton("down", trKey("Опустить слой"), Glyph.ArrowDown, () => commands.move(id, 1), { disabled: last }),
    toolButton("remove", trKey("Удалить слой"), Glyph.Trash, () => commands.remove(id), { danger: true }),
  ];
}

function newLayerOptions() {
  return NEW_LAYER_KINDS.map(([value, glyph, name, hint]) => ({
    value,
    label: tr(name),
    icon: h(glyph),
    title: hint ? tr(hint) : undefined,
  }));
}

function StackFooter({ layers, current, commands }) {
  const menu = h(MenuButton, {
    className: "gun-layer-add",
    menuClassName: "ui-layer-menu",
    variant: layers.length ? "ghost" : "secondary",
    size: "sm",
    icon: h(Glyph.Plus),
    label: tr("Слой"),
    ariaLabel: tr("Добавить слой"),
    options: newLayerOptions(),
    onSelect: commands.create,
  });
  const copy = current
    ? h(
        Button,
        { variant: "ghost", size: "sm", icon: h(Glyph.Copy), onClick: () => commands.duplicate(current.id) },
        tr("Копия слоя"),
      )
    : null;
  return h(Fragment, null, menu, copy);
}

function StackSection({ layers, current, activeId, onPick, commands }) {
  const list = h(LayerList, {
    className: "gun-layers",
    role: "tablist",
    label: tr("Слои"),
    items: layers.map(stackRow),
    value: activeId,
    onSelect: onPick,
    tools: (_item, index) => rowTools(layers[index], index, layers.length, commands),
    footer: h(StackFooter, { layers, current, commands }),
  });
  return h("section", { className: "ui-panel gun-panel" }, list);
}

// ───────── параметры выбранного слоя ─────────

function Field({ spec, layer, ctx }) {
  const id = layer.id;
  const send = (delta) => ctx.commands.patch(id, delta);
  const label = spec.label ? tr(spec.label) : undefined;

  switch (spec.type) {
    case "text":
      return h(TextField, {
        label,
        value: layer[spec.field],
        maxLength: spec.limit,
        onChange: (text) => send({ [spec.field]: text }),
      });
    case "blend":
      return h(BlendSelect, { value: layer.blend, onChange: (blend) => send({ blend }) });
    case "range": {
      const stored = layer[spec.field];
      return h(Slider, {
        label,
        value: spec.fallback === undefined ? stored : stored ?? spec.fallback,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        unit: spec.unit,
        onChange: (amount) => send({ [spec.field]: amount }),
      });
    }
    case "toggle":
      return h(
        Checkbox,
        { checked: Boolean(layer[spec.field]), onChange: (on) => send({ [spec.field]: on }) },
        h(Glyph.Intersect),
        ` ${tr(spec.caption)}`,
      );
    case "colour":
      return h(ColorField, { label, value: layer[spec.field], onChange: (hex) => send({ [spec.field]: hex }) });
    case "effect":
      return h(ColourEffectField, {
        label,
        modes: FILL_MODES,
        value: layer.effect ?? { mode: "solid", colour: layer.colour },
        directionLabels: trValues(DIRECTION_NAMES),
        hints: trValues(MODE_HINTS),
        onChange: (effect) =>
          send({ colour: effect.colour, effect: effect.mode === "solid" ? null : effect }),
      });
    case "font":
      return h(TextFontSelect, { layer, onPatch: send, onNotice: ctx.onNotice });
    case "help":
      return h(SectionHeading, { help: tr(spec.text(ctx)) });
    default:
      return null;
  }
}

function MaskControls({ layer, ctx }) {
  const id = layer.id;
  const { mask } = ctx.commands;
  const body = layer.mask
    ? [
        h(SegmentedControl, {
          label: tr("Кисть по маске"),
          size: "sm",
          options: MASK_BRUSHES.map(([value, name]) => ({ value, label: tr(name) })),
          value: ctx.maskMode,
          onChange: (brush) => mask.mode(id, brush),
        }),
        h(
          Checkbox,
          {
            checked: layer.maskEnabled !== false,
            onChange: (on) => ctx.commands.patch(id, { maskEnabled: on }),
          },
          tr("Маска включена"),
        ),
        h(
          "div",
          { className: "gun-row" },
          h(Button, { variant: "ghost", size: "sm", onClick: () => mask.reset(id) }, tr("Открыть весь слой")),
          h(Button, { variant: "ghost", size: "sm", onClick: () => mask.remove(id) }, tr("Удалить маску")),
        ),
      ]
    : [
        h(
          Button,
          {
            variant: "secondary",
            size: "sm",
            title: fill(tr("Прячет часть слоя кистью, не стирая его: {example}, — и всегда можно вернуть."), {
              example: ctx.noun.masked || tr("узор только на стволе, без рукояти"),
            }),
            onClick: () => mask.add(id),
          },
          tr("Добавить маску"),
        ),
      ];
  return h("div", { className: "gun-mask" }, h("h3", null, tr("Маска")), ...body);
}

function OptionsSection({ layer, ctx }) {
  const specs = [...COMMON_FIELDS, ...(KIND_FIELDS.get(layer.kind) ?? [])];
  const fields = [];
  // ключ — место поля в наборе вида: так поля не пересоздаются, когда соседнее то появляется, то исчезает
  specs.forEach((spec, slot) => {
    if (spec.when && !spec.when(layer, ctx)) return;
    fields.push(h(Field, { key: slot, spec, layer, ctx }));
  });
  return h(
    "section",
    { className: "ui-panel gun-panel gun-layer-options" },
    ...fields,
    when(ctx.hasMask, h(MaskControls, { key: "mask", layer, ctx })),
  );
}

// ───────── свечение ─────────

function glowHelp(glowing, glowGame) {
  const intro = glowing
    ? tr("Светящиеся слои горят своим цветом и в темноте. Светлые цвета светят ярче тёмных.")
    : tr("Подними у слоя ползунок «Свечение» — неоновые вставки, руны, трещины лавы загорятся своим цветом.");
  const inGame =
    glowGame === "off"
      ? tr("В игре детали не светятся — покраска едет как обычно, и в кадре свечения нет.")
      : fill(
          tr(
            "В игре светится вся деталь со светящимся слоем{night}: Astral переводит её шейдер на светящийся, как у неоновых паков, — в модели ствола из твоей игры. Светится покраска детали: тёмное остаётся тёмным, яркое горит. Наклейки в игре не светятся.",
          ),
          { night: glowGame === "night" ? tr(", и только в темноте") : "" },
        );
  return [intro, inGame];
}

function GlowSection({ glowGame, glowing, onGlowGame }) {
  return h(
    "section",
    { className: "ui-panel gun-panel" },
    h(SectionHeading, { title: tr("Свечение"), help: glowHelp(glowing, glowGame) }),
    h(SegmentedControl, {
      label: tr("В игре"),
      size: "sm",
      options: GLOW_GAME_MODES.map((mode) => ({ value: mode.id, label: tr(mode.label.ru) })),
      value: glowGame,
      onChange: (mode) => onGlowGame?.(mode),
    }),
  );
}

// ───────── панель ─────────

export default function GunLayersPanel({
  onLayerPatch,
  onLayerMove,
  onLayerRemove,
  onLayerDuplicate,
  onAddLayer,
  onUploadUvImage,
  onActiveMaterial,
  onActiveLayer,
  onGlowGame,
  onMask,
  onNotice = null,
  layers,
  activeLayerId,
  materials,
  activeMaterial,
  noun = weaponNoun,
  maskMode = "off",
  patterns = true,
  glowing = 0,
  glowGame = null,
}) {
  useTr();

  const current = layers.find((layer) => layer.id === activeLayerId);
  const commands = {
    patch: (id, delta) => onLayerPatch(id, delta),
    move: (id, step) => onLayerMove(id, step),
    remove: (id) => onLayerRemove(id),
    duplicate: (id) => onLayerDuplicate(id),
    create: (kind) => (kind === "image" ? onUploadUvImage() : onAddLayer(kind)),
    mask: {
      mode: (id, brush) => onMask.mode(id, brush),
      reset: (id) => onMask.reset(id),
      remove: (id) => onMask.remove(id),
      add: (id) => onMask.add(id),
    },
  };
  const ctx = { commands, noun, patterns, glowGame, maskMode, onNotice, hasMask: Boolean(onMask) };

  return h(
    Fragment,
    null,
    h(PartsSection, { noun, materials, active: activeMaterial, onPick: onActiveMaterial }),
    h(StackSection, { layers, current, activeId: activeLayerId, onPick: onActiveLayer, commands }),
    when(current, h(OptionsSection, { layer: current, ctx })),
    when(glowGame, h(GlowSection, { glowGame, glowing, onGlowGame })),
  );
}

// ───────── таблицы (ключи словаря, язык берётся при отрисовке) ─────────

const KIND_NAMES = new Map([
  ["paint", trKey("Роспись")],
  ["fill", trKey("Заливка")],
  ["pattern", trKey("Узор")],
  ["image", trKey("Картинка")],
  ["text", trKey("Надпись")],
  ["shade", trKey("Светотень")],
]);

const KIND_GLYPHS = new Map([
  ["shade", Glyph.CircleHalf],
  ["paint", Glyph.PaintBrush],
  ["image", Glyph.Image],
  ["text", Glyph.TextT],
  ["fill", Glyph.PaintBucket],
  ["pattern", Glyph.Swatches],
]);

const NEW_LAYER_KINDS = [
  ["paint", Glyph.PaintBrush, trKey("Роспись"), trKey("Новый слой росписи")],
  ["fill", Glyph.PaintBucket, trKey("Заливка"), trKey("Слой заливки")],
  ["pattern", Glyph.Swatches, trKey("Узор"), trKey("Слой узора")],
  ["image", Glyph.Image, trKey("Картинка по развёртке"), null],
  ["text", Glyph.TextT, trKey("Надпись"), null],
  ["shade", Glyph.CircleHalf, trKey("Светотень"), trKey("Светотень — складки и тени модели поверх покраски")],
];

const MASK_BRUSHES = [
  ["off", trKey("Красить")],
  ["hide", trKey("Скрыть")],
  ["reveal", trKey("Вернуть")],
];

const FILL_MODES = ["solid", "gradient", "rainbow", "shimmer"];

const DIRECTION_NAMES = {
  along: trKey("Слева направо"),
  across: trKey("Сверху вниз"),
  height: trKey("Снизу вверх"),
};

const MODE_HINTS = {
  gradient: trKey("Два цвета плавно переходят друг в друга по развёртке детали — так и запекутся в текстуру."),
  rainbow: trKey("Радуга по развёртке детали; сдвиг — с какого цвета она начинается."),
  shimmer: trKey(
    "Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный: он запекается в текстуру.",
  ),
};

const percent = (field, label, min, max, extra) => ({
  type: "range",
  field,
  label: trKey(label),
  min,
  max,
  unit: "%",
  ...extra,
});

const COMMON_FIELDS = [
  { type: "text", field: "name", label: trKey("Имя слоя"), limit: 80 },
  { type: "blend" },
  percent("opacity", "Непрозрачность", 0, 100),
  percent("glow", "Свечение", 0, 100, { fallback: 0, when: (_layer, ctx) => ctx.glowGame }),
  { type: "toggle", field: "clip", caption: trKey("Обтравка по слою ниже") },
];

const PLACEMENT_FIELDS = [
  percent("x", "По длине", -20, 120),
  percent("y", "По высоте", -20, 120),
  { ...percent("rotation", "Поворот", -180, 180), unit: "°" },
];

const KIND_FIELDS = new Map([
  ["fill", [{ type: "effect", label: trKey("Цвет заливки") }]],
  [
    "pattern",
    [
      {
        type: "help",
        text: (ctx) =>
          ctx.patterns
            ? trKey("Цвета, масштаб и вариант рисунка узора — в «Узорах».")
            : trKey("Узор лёг из пресета: его цвета меняет расцветка в «Шаблонах»."),
      },
    ],
  ],
  [
    "shade",
    [
      percent("contrast", "Глубина складок", 0, 200, { fallback: 100 }),
      {
        type: "help",
        text: () =>
          trKey("Складки, швы и тени самой модели поверх покраски. Держи слой наверху: всё, что под ним, получает объём ткани."),
      },
    ],
  ],
  ["image", [...PLACEMENT_FIELDS, percent("scale", "Размер", 2, 200)]],
  [
    "text",
    [
      ...PLACEMENT_FIELDS,
      { type: "text", field: "value", label: trKey("Текст"), limit: 120 },
      { type: "font" },
      percent("size", "Кегль", 2, 120),
      { type: "colour", field: "colour", label: trKey("Цвет") },
      percent("outlineWidth", "Обводка", 0, 12, { step: 0.5 }),
      { type: "colour", field: "outline", label: trKey("Цвет обводки"), when: (layer) => layer.outlineWidth > 0 },
    ],
  ],
]);
