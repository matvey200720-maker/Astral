import { createElement as el, Fragment, useMemo, useState } from "react";
import Button from "../../../../ui/Button.jsx";
import { MAX_STICKERS } from "@modovik/gun-studio";
import Checkbox from "../../../../ui/Checkbox.jsx";
import { fill, weaponNoun } from "../gun-copy.js";
import ColorField from "../../../../ui/ColorField.jsx";
import { BlendSelect } from "./GunLayerControls.jsx";
import LayerList from "../../../../ui/LayerList.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import {
  EMBLEMS,
  EMBLEM_GROUPS,
  EMBLEM_WEIGHTS,
  emblemSource,
  parseEmblemSource,
} from "../gun-emblems.js";
import Slider from "../../../../ui/Slider.jsx";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  Sticker as StickerIcon,
  EyeSlash,
  FlipHorizontal,
  ImageSquare,
  PencilLine,
  Trash,
  X,
} from "../../../../ui/icons.jsx";
import SectionHeading from "../../../../../features/workshop/section-help.jsx";

const PANEL = "ui-panel gun-panel";
const LIGHT_INK = "#ffffff";
const DARK_INK = "#111214";
const EDITABLE = { editable: true };

const SWATCHES = {
  pick: ["#ffffff", "#111214", "#d4a72c", "#b3261e", "#2ef2ff", "#ff2e97", "#7cff00"],
  emblem: ["#ffffff", "#111214", "#d4a72c", "#b3261e", "#2ef2ff"],
  stencil: ["#111214", "#ffffff", "#d4a72c", "#b3261e", "#2ef2ff"],
};

/* ---------- значки и строки-описания ---------- */

// Необязательное свойство соседа: попадает в объект только если оно было задано.
const only = (extras, name) =>
  extras && Object.hasOwn(extras, name) ? { [name]: extras[name] } : null;

function StickerGlyph({ source }) {
  const parsed = parseEmblemSource(source);
  if (!parsed) return el(ImageSquare);
  const { weight, emblem } = parsed;
  return el(emblem.Icon, { weight });
}

// Подложка под значок: красится tint-ом и в руке, и в списке.
function badge(className, holder) {
  const style = { color: holder.tint || undefined };
  return el("span", { className, style }, el(StickerGlyph, { source: holder.source }));
}

// Вид ряда -> построитель узла. Первым аргументом всегда идёт id (он же ключ).
const DRAW = {
  range(id, label, value, min, max, unit, extras, onChange) {
    const props = {
      key: id,
      label,
      ...only(extras, "hint"),
      value,
      min,
      max,
      unit,
      ...only(extras, "editable"),
      onChange,
    };
    return el(Slider, props);
  },
  ink(id, label, value, swatches, onChange) {
    const props = { key: id, label, value, ...(swatches ? { swatches } : null), onChange };
    return el(ColorField, props);
  },
  check(id, checked, onChange, icon, label) {
    const content = icon ? [el(icon), " ", label] : [label];
    return el(Checkbox, { key: id, checked, onChange }, ...content);
  },
  help(id, text) {
    return el(SectionHeading, { key: id, help: text });
  },
  blend(id, value, onChange) {
    return el(BlendSelect, { key: id, value, onChange });
  },
};

const drawRows = (rows) =>
  rows.map((row) => (row ? DRAW[row[1]](row[0], ...row.slice(2)) : null));

/* ---------- секция 1: что взять в руку ---------- */

function armedCard({ armed, noun, onDisarm }) {
  const hint = fill(
    tr("Ткни в {acc}. Колесо — поворот, R — на 90°, Shift + колесо — размер, Esc — убрать из руки."),
    noun,
  );
  const dropper = {
    variant: "ghost",
    size: "sm",
    icon: el(X),
    "aria-label": tr("Убрать из руки"),
    onClick: onDisarm,
  };
  return el(
    "div",
    { className: "gun-armed", role: "status" },
    badge("gun-armed-glyph", armed),
    el("span", null, el("strong", null, armed.name), el("small", null, hint)),
    el(Button, dropper),
  );
}

// Что показывать под заголовком: правила идут сверху вниз, срабатывает первое подошедшее.
const HAND_RULES = [
  [({ armed }) => armed, armedCard],
  [
    ({ full }) => !full,
    ({ noun }) => {
      const help = fill(
        tr("Выбери эмблему или свою картинку — потом ткни в {acc}, куда её приклеить."),
        noun,
      );
      return el(SectionHeading, { help });
    },
  ],
  [
    () => true,
    ({ noun }) => {
      const limit = { ...noun, max: MAX_STICKERS };
      const text = fill(
        tr("На {loc} уже {max} наклеек и надписей — удали одну, чтобы поставить новую."),
        limit,
      );
      return el("p", { className: "gun-hint" }, text);
    },
  ],
];

const handSlot = (ctx) => HAND_RULES.find(([applies]) => applies(ctx))[1](ctx);

function placesRow({ places, armed, selected, noun, onPlace }) {
  if (!(places?.length > 0)) return null;
  const subject = armed || selected;
  const captionOf = (place) => {
    if (!subject) return tr("Сначала возьми эмблему или выбери наклейку");
    const template = armed
      ? tr("Поставить «{name}»: {place}")
      : tr("Переставить «{name}»: {place}");
    return fill(template, { name: subject.name, place: place.label.toLowerCase() });
  };
  const buttons = places.map((place) => {
    const props = {
      key: place.id,
      variant: "secondary",
      size: "sm",
      disabled: !subject,
      title: captionOf(place),
      onClick: () => onPlace?.(place.id),
    };
    return el(Button, props, place.label);
  });
  const frame = {
    className: "gun-row gun-row-wrap",
    role: "group",
    "aria-label": fill(tr("Куда на {acc}"), noun),
  };
  return el("div", frame, buttons);
}

function uploadRow({ full, onUploadImage }) {
  const props = {
    variant: "secondary",
    size: "sm",
    icon: el(ImageSquare),
    disabled: full,
    onClick: onUploadImage,
  };
  return el("div", { className: "gun-row" }, el(Button, props, tr("Своя картинка")));
}

function emblemTile(item, { armed, full, tint, weight, onArm }) {
  const source = emblemSource(item.id, weight);
  const active = armed?.source === source;
  const props = {
    key: item.id,
    type: "button",
    className: active ? "is-active" : "",
    title: tr(item.label.ru),
    "aria-label": tr(item.label.ru),
    "aria-pressed": active,
    disabled: full,
    style: { color: tint },
    onClick: () => onArm({ source, tint, name: tr(item.label.ru) }),
  };
  return el("button", props, el(item.Icon, { weight }));
}

function emblemShelves(ctx) {
  return EMBLEM_GROUPS.map((group) => {
    const members = EMBLEMS.filter((item) => item.group === group.id);
    const tiles = members.map((item) => emblemTile(item, ctx));
    const grid = el("div", { className: "gun-emblem-grid" }, tiles);
    const title = el("h3", null, tr(group.label.ru));
    return el("div", { key: group.id, className: "gun-emblem-group" }, title, grid);
  });
}

function pickSection(ctx) {
  const { weights, weight, setWeight, tint, setTint } = ctx;
  const mode = {
    label: tr("Эмблема"),
    size: "sm",
    options: weights,
    value: weight,
    onChange: setWeight,
  };
  const ink = {
    label: tr("Цвет эмблемы"),
    value: tint,
    swatches: SWATCHES.pick,
    onChange: setTint,
  };
  return el(
    "section",
    { className: PANEL },
    el("h2", null, tr("Взять наклейку")),
    handSlot(ctx),
    placesRow(ctx),
    uploadRow(ctx),
    el(SegmentedControl, mode),
    el(ColorField, ink),
    emblemShelves(ctx),
  );
}

/* ---------- секция 2: список поставленных ---------- */

const tool = (id, label, icon, extra, onClick) => ({ id, label, icon, ...extra, onClick });

// Инструменты строки; в списке верхняя наклейка первая, поэтому top - перевёрнутая копия.
function toolsOf(top, { onPatch, onMove, onRemove }) {
  return (_, index) => {
    const sticker = top[index];
    const shown = sticker.visible;
    return [
      tool(
        "visible",
        shown ? tr("Скрыть наклейку") : tr("Показать наклейку"),
        shown ? el(Eye) : el(EyeSlash),
        null,
        () => onPatch(sticker.id, { visible: !sticker.visible }),
      ),
      tool("up", tr("Поднять наклейку"), el(ArrowUp), { disabled: index === 0 }, () =>
        onMove(sticker.id, 1),
      ),
      tool(
        "down",
        tr("Опустить наклейку"),
        el(ArrowDown),
        { disabled: index === top.length - 1 },
        () => onMove(sticker.id, -1),
      ),
      tool("remove", tr("Удалить наклейку"), el(Trash), { danger: true }, () =>
        onRemove(sticker.id),
      ),
    ];
  };
}

const itemOf = (sticker) =>
  Object.fromEntries([
    ["id", sticker.id],
    ["title", sticker.name],
    ["meta", sticker.visible ? "" : tr("скрыта")],
    ["thumb", badge("gun-list-glyph", sticker)],
  ]);

function stackBody({ stickers, selectedId, onSelect, handlers }, caption) {
  if (stickers.length === 0) return el("p", { className: "gun-hint" }, tr("Пока пусто."));
  const top = [...stickers].reverse();
  const list = {
    className: "gun-stickers",
    role: "tablist",
    label: caption,
    items: top.map(itemOf),
    value: selectedId,
    onSelect,
    tools: toolsOf(top, handlers),
  };
  return el(LayerList, list);
}

function stackSection(ctx) {
  const caption = fill(tr("На {loc}"), ctx.noun);
  const counter = fill(tr("{n} из {max}"), { n: ctx.stickers.length, max: MAX_STICKERS });
  return el(
    "section",
    { className: PANEL },
    el("h2", null, caption, " ", el("small", null, counter)),
    stackBody(ctx, caption),
  );
}

/* ---------- секция 3: свойства выбранной ---------- */

// Ряды вида «внешность»: у эмблемы один цвет, у своей картинки - трафарет.
function lookRows(s, patch, set) {
  if (parseEmblemSource(s.source)) {
    const emblemInk = s.tint || LIGHT_INK;
    return [["tint", "ink", tr("Цвет эмблемы"), emblemInk, SWATCHES.emblem, set("tint")]];
  }
  const on = s.stencil > 0;
  const toggle = (next) =>
    patch(next ? { stencil: 50, tint: s.tint || DARK_INK } : { stencil: 0, tint: "" });
  const stencilInk = s.tint || DARK_INK;
  const head = [
    "stencilOn",
    "check",
    on,
    toggle,
    PencilLine,
    tr("Обрисовать — трафарет одного цвета"),
  ];
  if (!on) return [head];
  return [
    head,
    [
      "stencilHelp",
      "help",
      tr("Тёмное на картинке станет краской, светлое — пустотой. Порог решает, где граница; дорисовать или подчистить — кистью и ластиком в «Краске»."),
    ],
    ["stencil", "range", tr("Порог"), s.stencil, 1, 100, "%", EDITABLE, set("stencil")],
    [
      "stencilInvert",
      "check",
      s.stencilInvert,
      set("stencilInvert"),
      null,
      tr("Краской — светлое"),
    ],
    ["stencilInk", "ink", tr("Цвет трафарета"), stencilInk, SWATCHES.stencil, set("tint")],
  ];
}

function propertySection(s, noun, onPatch) {
  const id = s.id;
  const patch = (fields) => onPatch(id, fields);
  const set = (field) => (value) => patch({ [field]: value });
  const help = fill(
    tr("Тащи наклейку по {dat}, чтобы переставить. Q и E — повернуть, Delete — удалить."),
    noun,
  );
  const wearHint = { hint: tr("Как в CS2: наклейка стирается пятнами") };
  const rows = [
    ["size", "range", tr("Размер"), s.size, 1, 100, "%", EDITABLE, set("size")],
    ["rotation", "range", tr("Поворот"), s.rotation, -180, 180, "°", EDITABLE, set("rotation")],
    ["flip", "check", s.flip, set("flip"), FlipHorizontal, tr("Отразить")],
    ...lookRows(s, patch, set),
    ["outline", "range", tr("Кайма вырезки"), s.outline, 0, 20, "%", null, set("outline")],
    s.outline > 0 &&
      ["outlineInk", "ink", tr("Цвет каймы"), s.outlineColour, null, set("outlineColour")],
    ["wear", "range", tr("Соскоб"), s.wear, 0, 100, "%", wearHint, set("wear")],
    ["blend", "blend", s.blend, set("blend")],
    ["opacity", "range", tr("Непрозрачность"), s.opacity, 0, 100, "%", null, set("opacity")],
  ];
  return el(
    "section",
    { className: PANEL },
    el("h2", null, el(StickerIcon), " ", s.name),
    el(SectionHeading, { help }),
    drawRows(rows),
  );
}

/* ---------- состояние и сама панель ---------- */

// Всё состояние панели: язык, начертание, цвет и выбранная наклейка (порядок хуков фиксирован).
function useStickerDesk(stickers, selectedId) {
  useTr();
  const [weight, setWeight] = useState("fill");
  const [tint, setTint] = useState(LIGHT_INK);
  const selected = useMemo(
    () => stickers.find((item) => item.id === selectedId) || null,
    [stickers, selectedId],
  );
  return { weight, setWeight, tint, setTint, selected };
}

const asOption = ({ id, label }) => ({ value: id, label: tr(label.ru) });

export default function GunStickerPanel(props) {
  const { stickers, selectedId, onSelect, onPatch, onMove, onRemove } = props;
  const { armed, onArm, onDisarm, onUploadImage, onPlace } = props;
  const { noun = weaponNoun, places = null, total = stickers.length } = props;
  const desk = useStickerDesk(stickers, selectedId);
  const { selected } = desk;
  const pick = {
    ...desk,
    noun,
    armed,
    onArm,
    onDisarm,
    onUploadImage,
    places,
    onPlace,
    weights: EMBLEM_WEIGHTS.map(asOption),
    full: total >= MAX_STICKERS,
  };
  const stack = { stickers, noun, selectedId, onSelect, handlers: { onPatch, onMove, onRemove } };

  return el(
    Fragment,
    null,
    pickSection(pick),
    stackSection(stack),
    selected && propertySection(selected, noun, onPatch),
  );
}
