import { createElement as h, useRef } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "../../../components/ui/icons.jsx";
import {
  EMBLEM_KIND_LIMIT,
  EMBLEM_LABEL_LIMIT,
  EMBLEM_TEXT_FONTS,
  EMBLEM_TEXT_FONT_LABELS,
  EMBLEM_TEXT_LIMIT,
  emblemTitle,
} from "@modovik/climb-contract/recolor/emblems";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import Button from "../../../components/ui/Button.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import {
  HANGAR_EMBLEM_ACCEPT,
  convertedImageText,
  saveHangarEmblem,
  useHangarEmblemUrl,
} from "../hangar-editor/hangar-emblem.js";
import { emblemCssFont } from "./emblem-items.js";
import FontSources from "./FontSources.jsx";
import OutlineControl from "./OutlineControl.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import SectionHeading from "../section-help.jsx";

/* ---------- числа, словари, таблицы ---------- */

const metres = (value) => `${String(Math.round(value * 10) / 10).replace(".", ",")} м`;
const percent = (value) => `${Math.round(value)}\u00a0%`;
const degrees = (value) => `${Math.round(value)}°`;

const TEXT_SWATCHES = Object.freeze([
  "#f2f2f2",
  "#101114",
  "#f2c200",
  "#d9621f",
  "#a4161a",
  "#1f5fae",
  "#2e8b57",
  "#7b2cff",
]);

const KIND_WORDS = {
  image: { title: "Эмблемы", list: "Список эмблем", many: "эмблем" },
  text: { title: "Текст", list: "Список надписей", many: "надписей" },
  all: { title: "Эмблемы и надписи", list: "Список эмблем", many: "эмблем" },
};

// Подписи к правкам: поле → вид строки → что записать в журнал правок.
// Читается в момент правки, поэтому язык берётся актуальный.
const PATCH_NOTES = {
  size: { text: () => tr("Размер надписи"), image: () => tr("Размер эмблемы") },
  angle: { text: () => tr("Поворот надписи"), image: () => tr("Поворот эмблемы") },
  opacity: {
    text: () => tr("Непрозрачность надписи"),
    image: () => tr("Непрозрачность эмблемы"),
  },
};

const patchNote = (field, item) => PATCH_NOTES[field][item.kind === "text" ? "text" : "image"]();

const sampleFont = (text) => {
  const css = emblemCssFont(text);
  return { fontFamily: css.family, fontWeight: css.weight, fontStyle: css.style };
};

/* ---------- ряд выбора шрифта ---------- */

const fontChoices = (text) => {
  const ownKept = text.font === "custom" && text.fontAsset;
  return EMBLEM_TEXT_FONTS.filter((font) => font !== "custom" || ownKept).map((font) => [
    font,
    font === "custom" ? `Свой: ${text.fontName}` : EMBLEM_TEXT_FONT_LABELS[font],
  ]);
};

const fontRadio = (text, edit, tr) => ([font, label]) =>
  h(
    "button",
    {
      key: font,
      type: "button",
      role: "radio",
      className: text.font === font ? "emblem-font is-selected" : "emblem-font",
      "aria-checked": text.font === font,
      onClick: () => edit.patchText({ font }, "Надпись: шрифт"),
    },
    h(
      "span",
      {
        className: "emblem-font-sample",
        "data-audit-ignore": "type-min type-scale caps",
        style: sampleFont(font === "custom" ? text : { ...text, font }),
      },
      tr(label),
    ),
  );

const FontControls = ({ text, edit, onNotice, sourceRows = false }) => {
  const tr = useTr();
  const sources = {
    rows: sourceRows,
    onFont: (font) => edit.patchText({ font: "custom", ...font }, "Надпись: свой шрифт"),
    onNotice,
  };
  const group = h(
    "div",
    { className: "emblem-fonts", role: "radiogroup", "aria-label": tr("Шрифт") },
    fontChoices(text).map(fontRadio(text, edit, tr)),
  );
  return (
    <>
      {group}
      <FontSources {...sources} />
    </>
  );
};

/* ---------- строка списка ---------- */

const ROW_CAPTIONS = new Map([["text", (item) => `Надпись · ${metres(item.size)}`]]);
const sizeCaption = (item) => `${item.width} × ${item.height}`;
const captionOf = (item) => (ROW_CAPTIONS.get(item.kind) || sizeCaption)(item);

const thumbOf = (url) => (url ? h("img", { src: url, alt: "" }) : h("i", { "aria-hidden": "true" }));

const EmblemRow = ({ item, selected, single, first, last, onSelect, onMove, onRemove }) => {
  const url = useHangarEmblemUrl(item.asset);
  const title = emblemTitle(item);
  const arrows = single
    ? []
    : [
        ["Выше", ArrowUp, first, -1],
        ["Ниже", ArrowDown, last, 1],
      ];
  const ghost = (own) => h(Button, { size: "sm", variant: "ghost", ...own });
  const pick = h(
    "button",
    {
      type: "button",
      className: "recolor-row recolor-emblem-pick",
      "aria-pressed": selected,
      onClick: () => onSelect(item.id),
    },
    thumbOf(url),
    h("span", null, h("b", { "data-audit-ignore": "caps" }, title), h("small", null, captionOf(item))),
  );
  return h(
    "li",
    { className: selected ? "recolor-emblem-row is-selected" : "recolor-emblem-row" },
    pick,
    ...arrows.map(([word, Glyph, disabled, step]) =>
      ghost({
        key: word,
        icon: h(Glyph),
        ariaLabel: `${word}: ${title}`,
        disabled,
        onClick: () => onMove(item.id, step),
      }),
    ),
    ghost({ icon: h(X), ariaLabel: `Убрать: ${title}`, onClick: () => onRemove(item.id) }),
  );
};

/* ---------- работа с файлами ---------- */

const readPickedFile = (edit) => (event) => {
  const chosen = event.target.files?.[0];
  event.target.value = "";
  edit.addImage(chosen);
};

// Файл из окошка картинки: без выбранной эмблемы — новая, иначе заменяем выбранную.
async function takeFile({ edit, onNotice, picked }, file) {
  if (!picked) return edit.addImage(file);
  try {
    const { converted, ...stored } = await saveHangarEmblem(file);
    edit.patch(stored, tr("Эмблема: картинка"));
    if (converted) onNotice?.(convertedImageText(converted), "info");
  } catch (error) {
    onNotice?.(String(error?.message || error), "error");
  }
  return undefined;
}

/* ---------- куски раздела ---------- */

const helpLines = ({ kind, intro, note }, tr) =>
  [
    kind === "text" && tr("Щёлкните по модели и печатайте. Двойной щелчок — править, потянуть — двигать."),
    kind !== "text" && intro,
    note,
  ].filter(Boolean);

const pictureProps = (c, tr) => {
  const { picked, edit } = c;
  const known = Boolean(picked?.width && picked?.height);
  return {
    label: picked ? `${tr("Картинка")}: ${emblemTitle(picked)}` : tr("Своя картинка"),
    src: c.url,
    aspect: known ? picked.width / picked.height : 16 / 9,
    fit: "contain",
    caption: picked ? `${picked.name || tr("Своя картинка")} · ${picked.width} × ${picked.height}` : "",
    empty: tr("Своя картинка"),
    accept: HANGAR_EMBLEM_ACCEPT,
    hint: tr(
      "PNG, JPEG, WebP, BMP, GIF или AVIF — большая картинка уменьшится сама до 2048 px. Картинка остаётся на этом компьютере: в код для друга она не едет.",
    ),
    dropLabel: tr("Отпустите — встанет картинкой"),
    busy: edit.busy,
    disabled: !picked && edit.full,
    "data-emblem-picture": picked ? "set" : "empty",
    onFile: (file) => takeFile(c, file),
    onClear: picked ? () => edit.remove(picked.id) : null,
    clearLabel: tr("Убрать"),
  };
};

const hiddenPicker = (c, tr) =>
  h("input", {
    ref: c.input,
    type: "file",
    accept: HANGAR_EMBLEM_ACCEPT,
    hidden: true,
    onChange: readPickedFile(c.edit),
    "aria-label": tr("Картинка эмблемы"),
  });

const emblemList = ({ edit, words }) => {
  const { items, selected } = edit;
  if (!items.length) return null;
  const rows = items.map((item, index) =>
    h(EmblemRow, {
      key: item.id,
      item,
      selected: item.id === selected?.id,
      single: items.length === 1,
      first: index === 0,
      last: index === items.length - 1,
      onSelect: edit.select,
      onMove: edit.move,
      onRemove: edit.remove,
    }),
  );
  return h("ul", { className: "recolor-emblem-list", "aria-label": words.list }, rows);
};

const addGroup = ({ edit, images, texts, input }, tr) => {
  const withImages = images && edit.items.length > 0;
  if (edit.full || !(withImages || texts)) return null;
  const imageRow = withImages
    ? h(NavRow, {
        icon: h(Plus),
        title: edit.busy ? tr("Читаем…") : tr("Добавить картинку"),
        disabled: edit.busy,
        onOpen: () => input.current?.click(),
      })
    : null;
  const textRow = texts
    ? h(NavRow, { icon: h(Plus), title: tr("Добавить надпись"), onOpen: edit.addText })
    : null;
  return h(ListGroup, { label: tr("Добавить") }, imageRow, textRow);
};

const limitNote = ({ words }) =>
  h(
    "p",
    { className: "fx-hint" },
    "Это ",
    EMBLEM_KIND_LIMIT,
    " ",
    words.many,
    " — больше на одно место не поставить. Уберите лишнюю.",
  );

/* ---------- настройки выбранной ---------- */

const nameHint = (item, tr) => {
  if (item.kind !== "text") return item.name || tr("Своя картинка");
  return item.text.value.trim() || tr("Надпись");
};

const nameField = ({ edit, selected }, tr) =>
  h(TextField, {
    label: tr("Имя в списке"),
    value: selected.label || "",
    maxLength: EMBLEM_LABEL_LIMIT,
    placeholder: nameHint(selected, tr),
    onChange: (value) => edit.rename(selected.id, value),
  });

// Поля надписи отдельным списком с ключами: место в разметке остаётся одним.
const textFieldList = ({ edit, selected, onNotice }, tr) => {
  if (selected.kind !== "text") return null;
  const { text } = selected;
  const setter = (field, note) => (next) => edit.patchText({ [field]: next }, note);
  return [
    h(TextField, {
      key: "value",
      label: tr("Текст"),
      value: text.value,
      maxLength: EMBLEM_TEXT_LIMIT,
      placeholder: tr("Например, название семьи"),
      onChange: setter("value", "Надпись: текст"),
    }),
    h(FontControls, { key: "font", text, edit, onNotice }),
    h(ColorField, {
      key: "colour",
      label: tr("Цвет"),
      value: text.colour,
      swatches: TEXT_SWATCHES,
      editable: true,
      onChange: setter("colour", "Надпись: цвет"),
    }),
    h(OutlineControl, { key: "outline", value: text.outline, onChange: setter("outline", "Надпись: обводка") }),
  ];
};

const placingBox = ({ edit, selected, kind }, tr) => {
  if (!(selected.asset || kind === "text")) return null;
  const hidden = kind === "text" && edit.placing;
  const toggle = hidden
    ? null
    : h(
        Button,
        {
          size: "sm",
          variant: edit.placing ? "primary" : "secondary",
          "aria-pressed": edit.placing,
          onClick: () => edit.setPlacing(!edit.placing),
        },
        edit.placing ? tr("Готово") : tr("Ставить в кадре"),
      );
  return h("div", { className: "recolor-actions" }, toggle);
};

const sliderList = ({ edit, selected, sizeRange, rotatable }, tr) => {
  const isText = selected.kind === "text";
  const specs = [
    {
      field: "size",
      label: isText ? tr("Высота букв") : tr("Высота"),
      value: selected.size,
      min: sizeRange[0],
      max: sizeRange[1],
      step: 0.5,
      format: metres,
    },
    rotatable
      ? {
          field: "angle",
          label: tr("Поворот"),
          value: selected.angle || 0,
          min: -180,
          max: 180,
          step: 5,
          format: degrees,
        }
      : null,
    { field: "opacity", label: tr("Непрозрачность"), value: selected.opacity, min: 0, max: 100, format: percent },
  ];
  return specs
    .filter(Boolean)
    .map(({ field, ...look }) =>
      h(Slider, {
        key: field,
        ...look,
        onChange: (next) => edit.patch({ [field]: next }, patchNote(field, selected)),
      }),
    );
};

const resetRows = ({ onReset, resetLabel, selected }, tr) =>
  onReset && (selected.asset || selected.kind === "text")
    ? h(ActionRows, {
        label: tr("Действия с эмблемой"),
        actions: [{ id: "reset", label: resetLabel, onClick: () => onReset(selected) }],
      })
    : null;

const settingsBox = (c, tr) =>
  h(
    "div",
    {
      className: "recolor-subsection",
      role: "group",
      "aria-label": `Настройки: ${emblemTitle(c.selected)}`,
    },
    nameField(c, tr),
    textFieldList(c, tr),
    c.extra?.(c.selected),
    placingBox(c, tr),
    sliderList(c, tr),
    resetRows(c, tr),
  );

/* ---------- сам раздел ---------- */

const EmblemSection = ({
  edit,
  kind = "all",
  sizeRange,
  resetLabel = "",
  onReset = null,
  intro = "",
  note = "",
  extra = null,
  rotatable = true,
  onNotice = null,
}) => {
  const tr = useTr();
  const input = useRef(null);
  const words = KIND_WORDS[kind] || KIND_WORDS.all;
  const selected = edit.selected;
  const picked = selected?.kind === "image" ? selected : null;
  const url = useHangarEmblemUrl(picked?.asset || "");
  const c = {
    edit,
    kind,
    sizeRange,
    resetLabel,
    onReset,
    intro,
    note,
    extra,
    rotatable,
    onNotice,
    input,
    words,
    selected,
    picked,
    url,
    images: kind !== "text",
    texts: kind !== "image",
  };

  return h(
    "section",
    { className: "ui-panel fx-section recolor-section", "aria-label": words.title },
    h(SectionHeading, { title: kind === "all" ? words.title : "", help: helpLines(c, tr) }),
    c.images ? h(SurfacePicture, pictureProps(c, tr)) : null,
    c.images ? hiddenPicker(c, tr) : null,
    emblemList(c),
    addGroup(c, tr),
    edit.full ? limitNote(c) : null,
    selected ? settingsBox(c, tr) : null,
  );
};

export { EmblemSection, FontControls };
export default EmblemSection;
