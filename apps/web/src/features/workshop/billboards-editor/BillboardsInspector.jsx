import { tr, trAny, useTr } from "../../../locales/ui.js";
import {
  trFill,
  splitPartners,
  percentText,
  pixelsText,
  linkedOthers,
  linkKind,
  kindOptions,
  kindCounts,
  gifStateWord,
  gifStateNote,
  gifCountText,
  boardsText,
  boardsByDistrict,
  boardStateText,
  boardLine,
  boardLabelText,
  aspectText,
  DIRECTION_OPTIONS,
  BILLBOARD_TOTAL,
  BILLBOARD_SWATCHES,
} from "./billboards-text.js";
import BillboardsPresets from "./BillboardsPresets.jsx";
import BillboardsMap from "./BillboardsMap.jsx";
import BillboardsDrawTool from "./BillboardsDrawTool.jsx";
import { billboardsAllSurface, billboardStudioSurface } from "./billboards-studio.js";
import { stockFace } from "./billboards-art.js";
import { useSurfaceStock } from "../surface-stock.js";
import { useStudioLive } from "../texture-studio/StudioLive.jsx";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import { saveGifSurfacePicture } from "../models/model-assets.js";
import { useHangarEmblemUrl, convertedImageText, HANGAR_EMBLEM_ACCEPT } from "../hangar-editor/hangar-emblem.js";
import {
  UploadSimple,
  Palette,
  MapTrifold,
  CircleHalf,
  CheckSquare,
  CaretRight,
  CaretDown,
} from "../../../components/ui/icons.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import SurfaceFit from "../../../components/ui/SurfaceFit.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import ListGroup, { ListSwatch, ListSub, ListRow } from "../../../components/ui/ListGroup.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import Checkbox from "../../../components/ui/Checkbox.jsx";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { GIF_SURFACE_PROFILES } from "@modovik/climb-contract/recolor/gif-surface";
import {
  billboardsProjectIsStock,
  billboardSheet,
  billboardRecommendedPixels,
  billboardLookOf,
  billboardLookIsStock,
  billboardLiveState,
  billboardIsOwn,
  billboardCropWindow,
  billboard,
  BILLBOARD_ZOOM,
  BILLBOARD_PAN,
  BILLBOARD_GLOW,
  BILLBOARD_BRIGHTNESS,
} from "@modovik/climb-contract/recolor/billboards";
import { useState, useRef, useMemo, useEffect, Fragment, createElement as h } from "react";

const IMAGE_HINT =
  "PNG, JPEG, WebP, BMP, GIF или AVIF — большая картинка уменьшится сама до 2048 px. Гифка (и анимированные PNG и WebP) играет живой плашкой на щитах со своим обликом — до 12 на работу, на остальных стоит первым кадром. Картинка остаётся на этом компьютере: в код для друга она не едет.";
// Пропорция «Всех щитов» для рамки.
const ALL_PIXELS = Object.freeze([1024, 448]);
const SLIDER_STEP = 5;
const FAR_LIMIT = 40;

/* ---------- мелочи общего назначения ---------- */

const fromPairs = (pairs) => Object.fromEntries(pairs);
const maxLiveGifs = () => GIF_SURFACE_PROFILES.billboards.maxLive;
const labelOf = (text) => trAny(text) || text;
const caret = (isOpen) => h(isOpen ? CaretDown : CaretRight, { "aria-hidden": "true" });
const ownCount = ({ boards }) => Object.keys(boards).length;

function when(condition, make) {
  return condition ? make() : false;
}

// Строка действия для ActionRows: extra вклинивается между подписью и обработчиком.
function act(id, label, onClick, extra) {
  return Object.assign({ id, label }, extra, { onClick });
}

function pluck(source, keys) {
  return fromPairs(keys.map((key) => [key, source[key]]));
}

// Свойства, которые не заданы (undefined), получают значения по умолчанию.
function settle(props, defaults) {
  const merged = { ...props };
  for (const key of Object.keys(defaults)) {
    if (merged[key] === undefined) merged[key] = defaults[key];
  }
  return merged;
}

// Яркость и свечение «как в игре».
function gameLight() {
  return { brightness: BILLBOARD_BRIGHTNESS.standard, glow: BILLBOARD_GLOW.standard };
}

/* ---------- облик: подписи и подгонка ---------- */

const FILL_BY_MODE = {
  colour: (look) => look.colour,
  gradient: (look) =>
    `linear-gradient(${look.direction === "down" ? "180deg" : "90deg"}, ${look.colour}, ${look.colour2})`,
};

function lookFill(look) {
  const paint = FILL_BY_MODE[look.mode];
  return paint ? paint(look) : "";
}

function imageCaption(image, gifState) {
  const parts = [image.name || tr("Своя картинка")];
  if (image.animation) parts.push(trFill("гифка, {0}", gifStateWord(gifState)));
  return parts.join(" · ");
}

function lookCaption(look, gifState) {
  switch (look.mode) {
    case "image":
      return look.image.asset ? imageCaption(look.image, gifState) : "";
    case "colour":
      return [tr("Ровный цвет"), look.colour.toUpperCase()].join(" · ");
    case "gradient":
      return tr("Градиент");
    default:
      return "";
  }
}

function misfit({ width, height }, [pixelsW, pixelsH]) {
  if (!width || !height) return false;
  return Math.abs(width / height / (pixelsW / pixelsH) - 1) > 0.02;
}

function fitHow(fit) {
  switch (fit) {
    case "cover":
      return tr("лишнее по краям обрежется поровну, без искажений");
    case "contain":
      return tr("картинка встанет целиком, поля — цветом фона");
    case "stretch":
      return tr("картинка растянется по щиту — пропорции исказятся");
    default:
      return undefined;
  }
}

function fitText(image, pixels, fit) {
  if (!misfit(image, pixels)) {
    return tr("Картинка ровно по пропорции щита — ляжет без обрезки и полей.");
  }
  const dims = [image.width, image.height];
  return trFill("Картинка {0} × {1} не по пропорции щита — Astral подгонит сам: {2}.", ...dims, fitHow(fit));
}

function brightnessChanged(look) {
  const pairs = [
    [look.brightness, BILLBOARD_BRIGHTNESS.standard],
    [look.glow, BILLBOARD_GLOW.standard],
  ];
  return pairs.some(([actual, standard]) => actual !== standard);
}

function gifInfo(project, state) {
  const info = { state };
  info.count = gifCountText(project);
  info.limit = maxLiveGifs();
  return info;
}

function sheetUnreadNote() {
  return tr(" Лист рекламы игры в этом окне не прочитан — под картинкой щита средний цвет листа.").trim();
}

/* ---------- сохранение картинки ---------- */

const failText = (error) => String(error?.message || error);

// Файл → сохранённая картинка → уведомления; between вклинивается
// между заметкой сохранения и заметкой о конвертации.
async function saveAndAnnounce(file, onNotice, apply, between) {
  const say = (text, level) => onNotice?.(text, level);
  const steps = (saved, notice, converted) => [
    () => apply(saved),
    () => notice && say(notice, "info"),
    () => between?.(saved, say),
    () => converted && say(convertedImageText(converted), "info"),
  ];
  try {
    const { converted, notice, ...saved } = await saveGifSurfacePicture(file, "billboards");
    for (const step of steps(saved, notice, converted)) step();
  } catch (error) {
    say(failText(error), "error");
  }
}

function useBoardPicture(onImage, onNotice) {
  return (file) => saveAndAnnounce(file, onNotice, onImage);
}

/* ---------- «Что знать о щите» ---------- */

function linkedNote(board, linked) {
  if (linked.length === 0) return null;
  if (linkKind(board.id) !== "sides") {
    return trFill(
      "Этот лист у {0}: в игре у них одно место на листе, и картинка у них одна — правка ляжет на все сразу.",
      boardsText(linked.length + 1),
    );
  }
  return tr("Обе стороны щита — одна картинка: в игре их рисует одно место листа модели, и правка ляжет на обе.");
}

function partnerNames(list, limit) {
  const shown = Array.from(list.slice(0, limit), (item) => boardLabelText(item));
  return shown.join("; ") + (list.length > limit ? "…" : "");
}

function partnersNote(board, partners) {
  if (partners.length === 0) return null;
  let hdCopy = false;
  for (const face of board.faces) {
    if (face.split && billboardSheet(face.sheet)?.hd) hdCopy = true;
  }
  const text = trFill(
    "Лист этого щита в игре общий: на нём ещё {0} других моделей ({1}). Свой облик поедет своей копией словаря района: у модели этого щита будет свой лист, остальные не изменятся.",
    boardsText(partners.length),
    partnerNames(partners, 3),
  );
  return hdCopy ? text + tr(" Вплотную копия — обычной, не высокой чёткости.") : text;
}

function keepsNearSheet(board) {
  for (const face of board.faces) {
    const sheet = billboardSheet(face.sheet);
    if (sheet?.hd?.big || sheet?.big) return true;
  }
  return false;
}

function boardNotes(board, sheetsUnread) {
  const lines = [boardLine(board), linkedNote(board, linkedOthers(board.id)), partnersNote(board, splitPartners(board.id))];
  lines.push(
    keepsNearSheet(board)
      ? tr(
          "Вплотную этот щит останется рекламой игры: его лист высокой чёткости лежит в словаре района крупнее предела пакета Astral (16 МБ), и этот словарь в игру не едет. С улицы и издалека — ваш облик.",
        )
      : null,
  );
  if (sheetsUnread) lines.push(sheetUnreadNote());
  return lines.filter(Boolean);
}

/* ---------- редактор облика: расчёты ---------- */

function measureFrame(look, pixels, varied) {
  const { image, fit } = look;
  const target = pixels ? pixels : ALL_PIXELS;
  const boardRatio = target[0] / target[1];
  const sized = Boolean(image.width && image.height);
  const imageRatio = sized ? image.width / image.height : 0;
  const picture = Boolean(image.asset) && look.mode === "image";
  const cover = picture && fit === "cover";
  const centred = [
    [look.zoom, BILLBOARD_ZOOM.standard],
    [look.panX, BILLBOARD_PAN.standard],
    [look.panY, BILLBOARD_PAN.standard],
  ].every(([actual, standard]) => actual === standard);
  const needsFit = [varied, !centred, fit !== "cover"].some(Boolean) || misfit(image, target);
  return {
    target,
    picture,
    cover,
    centred,
    crop: cover && sized ? billboardCropWindow(look, imageRatio, boardRatio) : null,
    wider: sized ? imageRatio > boardRatio : true,
    showFit: picture && needsFit,
  };
}

// Правка одного поля облика: edit("colour", "gradient", подпись) → (значение) => onChange.
function makeEdit(set) {
  return (key, mode, text) => (value) => set(mode ? { mode, [key]: value } : { [key]: value }, text);
}

function sliderProps(value, range, format, onChange) {
  const { min, max } = range;
  return { min, max, step: SLIDER_STEP, value, format, onChange };
}

function panSlider(visible, [label, value, onChange]) {
  return visible && Object.assign({ label }, sliderProps(value, BILLBOARD_PAN, percentText, onChange));
}

function colourFieldProps(label, value, onChange) {
  return Object.assign({ editable: true, swatches: BILLBOARD_SWATCHES }, { label, value, onChange });
}

// Хуки редактора облика, в прежнем порядке: язык, раскрытая строка, реклама игры, адрес картинки.
function useLookResources({ stockBoard, look }) {
  const loadStock = stockBoard ? () => stockFace(stockBoard) : null;
  const stockId = (stockBoard && stockBoard.id) || "";
  useTr();
  const folded = useState("");
  const current = useSurfaceStock(loadStock, stockId);
  return { open: folded[0], setOpen: folded[1], current, url: useHangarEmblemUrl(look.image.asset) };
}

function helpLines(v) {
  const { pixels, image, frame, gif, state } = v;
  const lines = [...v.notes];
  if (pixels) {
    const [pixelsW, pixelsH] = pixels;
    lines.push(
      trFill("Лучше всего — {0}, пропорция {1}. Другой размер подгонится сам.", pixelsText(pixels), aspectText(pixelsW, pixelsH)),
    );
  }
  lines.push(tr(IMAGE_HINT));
  if (frame.picture && image.animation && gif) {
    lines.push([gifStateNote(state, gif.limit), gif.count || ""].join(" ").trim());
  }
  return lines.filter(Boolean);
}

/* ---------- редактор облика: части панели ---------- */

function pictureBlock(v) {
  const { look, image, frame, state, gif } = v;
  const animated = frame.picture && Boolean(image.animation);
  const pictureProps = fromPairs([
    ["label", v.surfaceLabel],
    ["src", frame.picture ? v.url : ""],
    ["current", v.current],
    ["fill", frame.picture ? "" : lookFill(look)],
    ["aspect", frame.target[0] / frame.target[1]],
    ["fit", look.fit],
    ["background", look.fit === "contain" ? look.background : ""],
    ["crop", frame.crop && !frame.centred ? frame.crop : null],
    ["caption", v.caption],
    ["empty", tr("Своя картинка")],
    ["hint", tr(IMAGE_HINT)],
    ["accept", HANGAR_EMBLEM_ACCEPT],
    ["dropLabel", trFill("Отпустите — встанет на {0}", labelOf(v.place))],
    ["onFile", v.take],
    ["onClear", !v.inherited && v.clear ? v.clear.run : null],
    ["clearLabel", v.clear?.label || ""],
    ["data-billboards-gif", animated ? state : undefined],
  ]);
  const warning = animated && (state === "limit" || state === "weight");
  const children = [h(SurfacePicture, pictureProps)];
  if (warning) {
    const note = h("p", { className: "fx-hint is-warning", role: "status", "data-billboards-gif": state }, gifStateNote(state, gif.limit));
    children.push(note);
  }
  const groupProps = fromPairs([
    ["title", tr("Картинка")],
    ["help", v.help],
    ["plain", true],
    ["data-billboards-section", "picture"],
  ]);
  return h(ListGroup, groupProps, ...children);
}

function fitBlock(v) {
  const { look, image, frame, varied } = v;
  const covering = look.fit === "cover";
  const zoomed = look.zoom > BILLBOARD_ZOOM.standard;
  const sliders = [
    [varied || frame.wider || zoomed, [tr("Сдвиг по ширине"), look.panX, v.edit("panX", null, tr("сдвиг картинки"))]],
    [varied || !frame.wider || zoomed, [tr("Сдвиг по высоте"), look.panY, v.edit("panY", null, tr("сдвиг картинки"))]],
  ];
  const zoomProps = sliderProps(look.zoom, BILLBOARD_ZOOM, percentText, v.edit("zoom", null, tr("масштаб картинки")));
  const backdrop = {
    value: look.background,
    swatches: BILLBOARD_SWATCHES,
    onChange: v.edit("background", null, tr("фон")),
  };
  const hints = [tr("«Заполнить» — без полей, лишнее обрежется; «Вписать» — картинка целиком, поля цветом фона; «Растянуть» — по полотну.")];
  hints.push(varied ? null : fitText(image, frame.target, look.fit));
  return h(
    SurfaceFit,
    fromPairs([
      ["fit", look.fit],
      ["onFit", v.edit("fit", null, tr("подгонка"))],
      ["help", hints],
      ["zoom", covering ? zoomProps : null],
      ["offsets", covering ? sliders.map(([visible, spec]) => panSlider(visible, spec)) : []],
      ["background", look.fit === "contain" ? backdrop : null],
      ["data-billboards-section", "fit"],
    ]),
  );
}

// Раскрывающаяся строка: ровный цвет и градиент отличаются только начинкой.
function foldRow(fold, [key, Icon, title, swatch, onClear, clearLabel], caption) {
  const isOpen = fold.open === key;
  const pairs = [
    ["icon", h(Icon)],
    ["title", title],
  ];
  if (caption !== undefined) pairs.push(["caption", caption]);
  pairs.push(
    ["trailing", h(Fragment, null, swatch, caret(isOpen))],
    ["expanded", isOpen],
    ["onOpen", () => fold.setOpen(isOpen ? "" : key)],
    ["onClear", onClear],
    ["clearLabel", clearLabel],
  );
  return h(ListRow, fromPairs(pairs));
}

function gradientFields(v) {
  const { look, edit } = v;
  const stops = [
    [tr("Первый цвет"), look.colour, edit("colour", "gradient", tr("первый цвет"))],
    [tr("Второй цвет"), look.colour2, edit("colour2", "gradient", tr("второй цвет"))],
  ];
  const direction = h(SegmentedControl, {
    label: tr("Направление"),
    size: "sm",
    options: DIRECTION_OPTIONS.map((option) => ({ ...option, label: tr(option.label) })),
    value: look.direction,
    onChange: edit("direction", "gradient", tr("направление")),
  });
  return [...stops.map((stop) => h(ColorField, colourFieldProps(...stop))), direction];
}

function studioButton(v) {
  const { image, frame } = v;
  return h(
    StudioPictureButton,
    fromPairs([
      ["getSurface", v.studio],
      ["image", frame.picture && !image.animation ? image : null],
      ["onImage", v.adopt(tr("рисунок из студии"))],
      ["onNotice", v.onNotice],
      ["slug", v.surfaceLabel],
      ["label", tr("Нарисовать в студии")],
      ["caption", tr("Кисть, слои, текст")],
    ]),
  );
}

function moreBlock(v) {
  const { look, open } = v;
  const fold = { open, setOpen: v.setOpen };
  const isColour = look.mode === "colour";
  const isGradient = look.mode === "gradient";
  const colourSwatch = h(ListSwatch, { colour: isColour ? look.colour : null });
  const colourRow = foldRow(
    fold,
    ["colour", Palette, tr("Ровный цвет"), colourSwatch, isColour ? v.reset(tr("без цвета")) : null, tr("без цвета")],
    isColour ? look.colour.toUpperCase() : null,
  );
  const gradientRow = foldRow(fold, [
    "gradient",
    CircleHalf,
    tr("Градиент"),
    isGradient && h(ListSwatch, { colour: look.colour }),
    isGradient ? v.reset(tr("без градиента")) : null,
    tr("без градиента"),
  ]);
  const colourPicker = h(ColorField, colourFieldProps(tr("Цвет щита"), look.colour, v.edit("colour", "colour", tr("цвет"))));
  return h(
    ListGroup,
    { title: tr("Цвет и рисунок"), "data-billboards-section": "more" },
    colourRow,
    open === "colour" && h(ListSub, null, colourPicker),
    gradientRow,
    open === "gradient" && h(ListSub, null, ...gradientFields(v)),
    v.studio && studioButton(v),
  );
}

/* ---------- редактор облика ---------- */

const LOOK_DEFAULTS = {
  varied: false,
  inherited: false,
  gif: null,
  studio: null,
  notes: [],
  captionPrefix: "",
  stockBoard: null,
  actions: [],
  clear: null,
  children: null,
};

function centrePatch() {
  const pan = Object.fromEntries(["panX", "panY"].map((axis) => [axis, BILLBOARD_PAN.standard]));
  return { zoom: BILLBOARD_ZOOM.standard, ...pan };
}

const pictureMode = (image) => (image.asset ? "image" : "standard");
const captionWithPrefix = (prefix, text) => (text ? prefix + text : "");

const adoptWith = (set, text) => (saved) => set(fromPairs([["mode", "image"], ["image", saved]]), text);

// Всё, что панель берёт из свойств, ресурсов и расчётов, в одном объекте для частей разметки.
function lookView(o, resources, set, take) {
  const { look, name } = o;
  const image = look.image;
  const back = pictureMode(image);
  const state = o.gif ? o.gif.state || "live" : "live";
  const view = Object.assign({}, o, resources, { image, set, take }, { state, back });
  Object.assign(view, {
    frame: measureFrame(look, o.pixels, o.varied),
    place: o.place === undefined ? name : o.place,
    edit: makeEdit(set),
    adopt: (text) => adoptWith(set, text),
    reset: (text) => () => set({ mode: back }, text),
    caption: captionWithPrefix(o.captionPrefix, lookCaption(look, state)),
    surfaceLabel: labelOf(name) + ": " + tr("своя картинка"),
  });
  view.help = helpLines(view);
  return view;
}

// «Кадр по центру» и «Вернуть яркость» идут перед действиями, которые передал хозяин панели.
function tuningActions(v) {
  const { look, set, frame } = v;
  const editable = !v.inherited;
  const needsCentre = frame.cover && !frame.centred;
  const needsLight = look.mode !== "standard" && brightnessChanged(look);
  return [
    when(editable && needsCentre, () =>
      act("crop-centre", tr("Кадр по центру"), () => set(centrePatch(), tr("кадр по центру"))),
    ),
    when(editable && needsLight, () =>
      act("brightness", tr("Вернуть яркость как в игре"), () => set(gameLight(), tr("яркость как в игре"))),
    ),
    ...v.actions,
  ];
}

function LookEditor(props) {
  const o = settle(props, LOOK_DEFAULTS);
  function set(patch, label) {
    return o.onChange(patch, o.name + ": " + label);
  }
  const resources = useLookResources(o);
  const take = useBoardPicture(adoptWith(set, tr("картинка")), o.onNotice);
  const v = lookView(o, resources, set, take);
  return h(
    Fragment,
    null,
    pictureBlock(v),
    v.frame.showFit && fitBlock(v),
    moreBlock(v),
    o.children,
    h(ActionRows, { actions: tuningActions(v) }),
  );
}

/* ---------- группа отмеченных полотен ---------- */

// Хуки группы: язык, скрытое поле файла, признак «читаем».
function useUploadSlot() {
  useTr();
  const input = useRef();
  const reading = useState(false);
  return { input, busy: reading[0], setBusy: reading[1] };
}

// Строка без стрелки справа: заголовок, необязательные добавки и обработчик.
function plainRow(title, onOpen, extra) {
  return h(ListRow, Object.assign({ title, trailing: null }, extra, { onOpen }));
}

function GroupRows(props) {
  const { boardId, foundIds, picked, onPick, onGroup, onNotice } = props;
  const { input, busy, setBusy } = useUploadSlot();
  const ids = Array.from(picked);
  const marked = ids.length > 0;
  const allFound = foundIds.length > 0 && !foundIds.some((id) => !picked.has(id));
  const offerFound = foundIds.length > 0 && !allFound;

  function announceGif(saved, say) {
    if (!saved.animation) return;
    const count = ids.length;
    const limit = maxLiveGifs();
    let text;
    if (count <= limit) {
      text = trFill("Гифка на {0} полотнах: играют те, что годятся под плашку; остальные стоят первым кадром.", count);
    } else {
      text = trFill("Гифка на {0} полотнах: играют до {1} из них, остальные стоят первым кадром.", count, limit);
    }
    say(text, "info");
  }

  async function pickImage(event) {
    const field = event.target;
    const file = field.files?.[0];
    field.value = "";
    if (!file || ids.length === 0) return;
    setBusy(true);
    await saveAndAnnounce(file, onNotice, (saved) => onGroup(ids, "image", saved), announceGif).finally(() => setBusy(false));
  }

  const rows = [];
  if (offerFound) {
    rows.push(
      plainRow(tr("Взять все найденные"), () => onPick(new Set(ids.concat(foundIds))), {
        caption: boardsText(foundIds.length),
      }),
    );
  }
  if (marked) {
    rows.push(
      h("input", {
        ref: input,
        type: "file",
        accept: HANGAR_EMBLEM_ACCEPT,
        hidden: true,
        onChange: pickImage,
        "aria-label": tr("Своя картинка на отмеченные"),
      }),
      plainRow(busy ? tr("Читаем…") : tr("Своя картинка на отмеченные"), () => input.current?.click(), {
        icon: h(UploadSimple),
        disabled: busy,
      }),
    );
    if (billboard(boardId)) {
      rows.push(plainRow(tr("Облик этого щита — на отмеченные"), () => onGroup(ids, "copy")));
    }
  }

  let heading = tr("Группа");
  if (marked) heading = trFill("Отмечено: {0}", ids.length);
  const groupHelp = tr(
    "Картинка и рисунок подгоняются под пропорцию каждого полотна сами: широкое фото на узком баннере — «Заполнить», без искажений.",
  );
  const listing =
    rows.length > 0 &&
    h(ListGroup, { title: heading, help: groupHelp, "data-billboards-section": "group" }, ...rows);

  const actions = [
    when(marked, () => act("group-clear-marks", tr("Снять отметки"), () => onPick(new Set()))),
    when(marked, () => act("group-clear", tr("Отмеченным — как у всех"), () => onGroup(ids, "clear"))),
  ];
  return h(Fragment, null, listing, h(ActionRows, { actions }));
}

/* ---------- «Где стоят» ---------- */

function collectIds(groups) {
  const ids = [];
  for (const { boards } of groups) {
    for (const board of boards) ids.push(board.id);
  }
  return ids;
}

function useDistrictIndex(query, kind) {
  const [groups, counts] = [
    useMemo(() => boardsByDistrict(query, kind), [query, kind]),
    useMemo(() => kindCounts(query), [query]),
  ];
  return { groups, counts, foundIds: useMemo(() => collectIds(groups), [groups]) };
}

// Район взятого щита: первая группа, где он нашёлся.
function districtOfBoard(groups, boardId) {
  for (const group of groups) {
    if (group.boards.some(({ id }) => id === boardId)) return group.district || "";
  }
  return "";
}

// Раскрытый район следует за районом взятого щита.
function useFollowedDistrict(home) {
  const [open, setOpen] = useState(() => home);
  useEffect(() => {
    setOpen((current) => home || current);
  }, [home]);
  return [open, setOpen];
}

function withMember(source, id, on) {
  const next = new Set(source);
  next[on ? "add" : "delete"](id);
  return next;
}

function boardRowOf(ctx) {
  return (board) => {
    const current = board.id === ctx.boardId;
    const mark = h(Checkbox, {
      ariaLabel: tr("В группу") + ": " + boardLabelText(board),
      checked: ctx.picked.has(board.id),
      onChange: (on) => ctx.toggle(board.id, on),
    });
    return h(
      ListRow,
      fromPairs([
        ["key", board.id],
        ["role", "listitem"],
        ["className", current ? "is-selected" : ""],
        ["title", boardLabelText(board)],
        ["caption", billboardIsOwn(ctx.project, board.id) ? boardStateText(ctx.project, board.id) : null],
        ["aria-current", current ? "true" : undefined],
        ["trailing", null],
        ["lead", ctx.checking ? mark : null],
        ["onOpen", () => ctx.onSelect(board.id)],
      ]),
    );
  };
}

function districtOf(rowOf, view) {
  return ({ district: id, boards }) => {
    const expanded = view.expandAll || view.open === id;
    const title = labelOf(id);
    const headProps = fromPairs([
      ["data-district", id],
      ["title", title],
      ["caption", boardsText(boards.length)],
      ["trailing", caret(expanded)],
      ["expanded", expanded],
      ["onOpen", () => view.setOpen(expanded ? "" : id)],
    ]);
    const head = h(ListRow, headProps);
    if (!expanded) return h(Fragment, { key: id }, head, false);
    const listAttrs = { className: "ui-list-group-list", role: "list", "aria-label": tr("Щиты") + ": " + title };
    return h(Fragment, { key: id }, head, h(ListSub, null, h("div", listAttrs, ...boards.map(rowOf))));
  };
}

const navRow = (title, caption, onOpen, extra) => h(NavRow, Object.assign({ title, caption }, extra, { onOpen }));

function WhereRows(props) {
  const { project, boardId, picked } = props;
  const { onSelect, onPick, onGroup, onNotice } = props;
  const searchKey = props.searchKey === undefined ? 0 : props.searchKey;
  useTr();
  const [[query, setQuery], [kind, setKind], [map, setMap], [every, setEvery], [marking, setMarking]] = [
    useState(""),
    useState("all"),
    useState(false),
    useState(false),
    useState(false),
  ];
  const search = useRef(null);
  const index = useDistrictIndex(query, kind);
  const { groups, foundIds } = index;
  const home = districtOfBoard(groups, boardId);
  const opened = useFollowedDistrict(home);
  const open = opened[0];
  const setOpen = opened[1];
  useEffect(() => {
    if (searchKey) {
      search.current?.focus();
    }
  }, [searchKey]);

  const filtered = [query, kind !== "all"].some(Boolean);
  const showAll = filtered || every;
  const shown = showAll ? groups : groups.filter(({ district }) => district === home);
  const ctx = {
    project,
    boardId,
    onSelect,
    picked,
    toggle: (id, on) => onPick(withMember(picked, id, on)),
    checking: marking || picked.size > 0,
  };
  const view = { expandAll: filtered && foundIds.length <= FAR_LIMIT, open, setOpen };
  const districtRows = shown.map(districtOf(boardRowOf(ctx), view));

  const moreDistricts =
    !showAll &&
    groups.length > shown.length &&
    navRow(tr("Все районы"), trFill("Районов: {0}", groups.length), () => setEvery(true));
  const markToggle =
    picked.size === 0 &&
    navRow(
      marking ? tr("Не отмечать") : tr("Отметить несколько"),
      marking ? null : tr("Один вид на группу щитов"),
      () => setMarking(!marking),
      { icon: h(CheckSquare), trailing: null },
    );
  const mapRow = h(
    ListRow,
    fromPairs([
      ["icon", h(MapTrifold)],
      ["title", tr("На карте")],
      ["caption", boardsText(foundIds.length)],
      ["trailing", caret(map)],
      ["expanded", map],
      ["onOpen", () => setMap(!map)],
    ]),
  );
  const mapPanel = map && h(ListSub, null, h(BillboardsMap, { found: foundIds, picked, boardId, onSelect }));

  const listing = h("div", { className: "ui-list-group-list" }, districtRows, moreDistricts, markToggle, mapRow, mapPanel);
  const emptyNote = h(
    "div",
    { className: "ui-surface-picture-caption", role: "status" },
    tr("Такого района нет — попробуйте часть названия."),
  );

  const controls = [
    h(TextField, {
      label: "",
      "aria-label": tr("Район или место"),
      value: query,
      placeholder: tr("Район или место"),
      onChange: setQuery,
      inputRef: search,
    }),
    h(SegmentedControl, {
      label: tr("Вид щита"),
      size: "sm",
      options: kindOptions(index.counts).map((option) => ({
        ...pluck(option, ["value", "label"]),
        title: boardsText(option.count),
      })),
      value: kind,
      onChange: setKind,
    }),
  ];
  const sectionProps = fromPairs([
    ["title", tr("Где стоят")],
    ["help", tr("Щелчок по строке — щит в кадре, флажок — в группу для одного облика.")],
    ["plain", true],
    ["data-billboards-section", "where"],
  ]);
  const section = h(ListGroup, sectionProps, ...controls, groups.length > 0 ? listing : emptyNote);
  const groupProps = { boardId, foundIds: filtered ? foundIds : [], picked, onPick, onGroup, onNotice };
  return h(Fragment, null, section, h(GroupRows, groupProps));
}

/* ---------- инструменты ---------- */

// Хуки «Всех щитов» и «Одного щита»: сначала студия, потом язык.
function useStudioAndLanguage() {
  const live = useStudioLive();
  useTr();
  return live;
}

function ownBoardsNote(own) {
  if (own > 0) return trFill("Щиты со своим обликом ({0}) остаются своими.", own);
  return tr("Любой щит потом можно поменять по одному — инструмент «Один щит».");
}

function AllTool(props) {
  const { project, onAll } = props;
  const look = project.all;
  const isStock = billboardLookIsStock(look);
  const asInGame = () => onAll({ mode: "standard", ...gameLight() }, tr("Все щиты") + ": " + tr("как в игре"));
  const live = useStudioAndLanguage();
  const own = ownCount(project);
  const notes = [
    trFill(
      "Облик ложится на все щиты карты ({0}): на крышах, у дорог и на стенах — вблизи и издалека. Картинка на каждом встаёт в его пропорции. Баннеры и большие полотна на зданиях правятся в «Баннерах на зданиях».",
      BILLBOARD_TOTAL,
    ),
    ownBoardsNote(own),
  ];
  if (props.sheetsUnread) notes.push(sheetUnreadNote());
  const actions = [
    when(!isStock, () => act("all-stock", tr("Как в игре"), asInGame)),
    when(own > 0, () =>
      act("clear-own", tr("Сделать все щиты одинаковыми"), props.onClearOwn, {
        title: trFill("Щиты со своим видом ({0}) станут как все", own),
      }),
    ),
  ];
  const framed = props.boardId === undefined ? "" : props.boardId;
  const editorProps = fromPairs([
    ["name", "Все щиты"],
    ["place", tr("все щиты")],
    ["look", look],
    ["stockBoard", billboard(framed)],
    ["pixels", ALL_PIXELS],
    ["varied", true],
    ["studio", () => billboardsAllSurface({ live })],
    ["notes", notes],
    ["onChange", onAll],
    ["onNotice", props.onNotice],
    ["gif", gifInfo(project, "shared")],
    ["clear", isStock ? null : { label: tr("как в игре"), run: asInGame }],
    ["actions", actions],
  ]);
  return h(LookEditor, editorProps);
}

// Хуки «Одного щита»: студия, язык, щит и его рекомендованный размер.
function useBoardSetup(boardId) {
  const [live, board] = [useStudioAndLanguage(), billboard(boardId)];
  return { live, board, pixels: useMemo(() => billboardRecommendedPixels(board), [board]) };
}

// Что известно о щите в проекте: облик, свой ли он, штатный ли, состояние живой плашки.
function boardStatus(project, boardId) {
  const look = billboardLookOf(project, boardId);
  return {
    look,
    own: billboardIsOwn(project, boardId),
    isStock: billboardLookIsStock(look),
    liveState: billboardLiveState(project).states.get(boardId) || "live",
  };
}

const forwardTo = (fn, first) => (...rest) => fn(first, ...rest);

function BoardTool(props) {
  const { project, boardId } = props;
  const { live, board, pixels } = useBoardSetup(boardId);
  if (!board) {
    return h("p", { className: "fx-hint" }, tr("Щит не найден — выберите другой над кадром."));
  }

  const { look, own, isStock, liveState } = boardStatus(project, boardId);
  const follow = () => props.onFollow(boardId);
  const actions = [
    when(own, () => act("follow-all", tr("Как у всех щитов"), follow)),
    when(!isStock, () => act("stock", tr("Как в игре"), () => props.onStock(boardId))),
  ];
  const prefix = own || isStock ? "" : tr("Как у всех щитов") + " · ";
  const editorProps = fromPairs([
    ["name", board.label],
    ["place", boardLabelText(board)],
    ["look", look],
    ["stockBoard", board],
    ["pixels", pixels],
    ["inherited", !own],
    ["captionPrefix", prefix],
    ["studio", () => billboardStudioSurface(board, { live })],
    ["notes", boardNotes(board, props.sheetsUnread)],
    ["onChange", forwardTo(props.onBoard, boardId)],
    ["onNotice", props.onNotice],
    ["gif", gifInfo(project, liveState)],
    ["clear", own ? { label: tr("Как у всех щитов"), run: follow } : null],
    ["actions", actions],
  ]);
  const whereProps = Object.assign({ project, boardId }, pluck(props, ["onSelect", "picked", "onPick", "onGroup"]));
  whereProps.onNotice = props.onNotice;
  whereProps.searchKey = props.searchKey;
  return h(LookEditor, editorProps, h(WhereRows, whereProps));
}

function TemplatesTool({ project, onPreset, onStandard }) {
  useTr();
  const standard = when(!billboardsProjectIsStock(project), () =>
    act("standard", tr("Как в игре"), onStandard, {
      title: tr("Все щиты как в игре: реклама, яркость и свечение штатные. Свои картинки и цвета панель помнит."),
    }),
  );
  return h(Fragment, null, h(BillboardsPresets, { project, onApply: onPreset }), h(ActionRows, { actions: [standard] }));
}

/* ---------- вход ---------- */

const ALL_KEYS = ["project", "boardId", "onAll", "onClearOwn", "onNotice", "sheetsUnread"];
const BOARD_KEYS = [
  "project",
  "boardId",
  "onBoard",
  "onFollow",
  "onStock",
  "onSelect",
  "onNotice",
  "sheetsUnread",
  "picked",
  "onPick",
  "onGroup",
  "searchKey",
];
const TEMPLATE_KEYS = ["project", "onPreset", "onStandard"];

const TOOL_VIEWS = {
  all: (props) => h(AllTool, pluck(props, ALL_KEYS)),
  board: (props) => h(BoardTool, pluck(props, BOARD_KEYS)),
  draw: ({ project, boardId, brush, onBrush, onClearDrawing }) =>
    h(BillboardsDrawTool, { project, boardId, brush, onBrush, onClear: onClearDrawing }),
};

const templatesView = (props) => h(TemplatesTool, pluck(props, TEMPLATE_KEYS));

function BillboardsInspector(props) {
  const { tool } = props;
  const sheetsUnread = props.sheetsUnread === undefined ? false : props.sheetsUnread;
  const searchKey = props.searchKey === undefined ? 0 : props.searchKey;
  const view = Object.hasOwn(TOOL_VIEWS, tool) ? TOOL_VIEWS[tool] : templatesView;
  return view({ ...props, sheetsUnread, searchKey });
}

export { LookEditor, useBoardPicture };
export default BillboardsInspector;
