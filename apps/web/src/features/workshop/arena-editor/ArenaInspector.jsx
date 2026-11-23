import TextField from "../../../components/ui/TextField.jsx";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import { ArenaSceneContext, useElementPicture } from "./arena-element-picture.js";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import { SLOT_LIMITS, normalizeSlotTransform } from "@modovik/climb-contract/recolor/arena-slots";
import Switch from "../../../components/ui/Switch.jsx";
import { createElement as h, useEffect, useState } from "react";
import FinishField from "../finish/FinishField.jsx";
import { EMBLEM_TEXT_LIMIT, normalizeEmblemText } from "@modovik/climb-contract/recolor/emblems";
import ColorField from "../../../components/ui/ColorField.jsx";
import { useStudioLive } from "../texture-studio/StudioLive.jsx";
import ListGroup, { ListRow, ListSub, ListSwatch } from "../../../components/ui/ListGroup.jsx";
import Select from "../../../components/ui/Select.jsx";
import { ArenaRow, useHelp } from "./arena-panel-parts.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import { arenaStudioSurface } from "./arena-studio.js";
import OutlineControl from "../emblem/OutlineControl.jsx";
import {
  ARENA_SECTION_LABELS, ARENA_SIGN_SECTIONS, ARENA_SIGN_VIEWS, ARENA_SWATCHES, STAR_ANIMATION_OPTIONS,
  STAR_STAND_OPTIONS, centimetresText, degreesText, metresText, offsetText, scaleText, speedText, surfaceModeOptions,
} from "./arena-text.js";
import ArenaTemplates from "./ArenaTemplates.jsx";
import EmblemSection, { FontControls } from "../emblem/EmblemSection.jsx";
import { trFill } from "../../../locales/tr-fill.js";
import ReplaceSection from "./arena-replace-section.jsx";
import { firstFramePicture, saveAnimatedPicture } from "../models/model-assets.js";
import ChairPicker from "./arena-chairs.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import LayersSection from "./arena-layers-section.jsx";
import {
  ARENA_EMBLEM_SIZE, ARENA_OBJECTS, ARENA_SLOT_DEFAULTS, ARENA_STANDARD_LABELS, ARENA_STAR_LIMITS, arenaElementModes,
  arenaElementOwn, arenaPanelFaceLimit, arenaSectionLabel, arenaPanelPlates, arenaPanelsAnimated, arenaPlaceElements,
  arenaPlaces, arenaSectionModes, arenaServerInventory, arenaSlotDefaults, arenaSlotElements, arenasProjectIsStock,
} from "@modovik/climb-contract/recolor/arenas";
import Button from "../../../components/ui/Button.jsx";
import ItemsSection, { surfaceStudio } from "./arena-items-section.jsx";
import { usePanelHelp } from "../../../components/ui/panel-help.js";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { arenaSurfaceProjected } from "@modovik/climb-contract/recolor/finish-walls";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import { CaretDown, CaretLeft, CaretRight, Check, Palette, TextT } from "../../../components/ui/icons.jsx";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import { HANGAR_EMBLEM_ACCEPT, convertedImageText, saveHangarEmblem, useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import SurfaceFit from "../../../components/ui/SurfaceFit.jsx";
import Slider from "../../../components/ui/Slider.jsx";

/* ---------- Тексты и таблицы ---------- */

const freezeRows = (rows) => Object.freeze(Object.fromEntries(rows));

const NO_IMAGE = Object.freeze({ asset: "", name: "", width: 0, height: 0 });
const EFFECT_MODES = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

const COPY = freezeRows([
  ["image", "PNG, JPEG, WebP, BMP, GIF или AVIF — большая картинка уменьшится сама до 2048 px. Картинка остаётся на этом компьютере: в код для друга она не едет."],
  ["panel", "PNG, JPEG, WebP, BMP или AVIF — своя картинка именно этого экрана, остальные не меняются. Гифка встанет первым кадром: зал Majestic — модель сервера, клипов анимации у неё нет, и файлом игры их не добавить. Картинка остаётся на этом компьютере."],
  ["live", "PNG, JPEG, WebP — картинкой; GIF (и анимированные PNG и WebP) — живым баннером: кадры сменяются и в кадре, и в игре. Картинка остаётся на этом компьютере: в код для друга она не едет."],
  ["sheetStill", "эта картинка лежит на общем листе арены, а клипов анимации у листа нет; живая гифка — на полотнах по одному (картины, баннеры, экраны арены GTA 5 RP)"],
  ["majesticStill", "зал Majestic — модель сервера, клипов анимации у неё нет"],
  ["starStill", "звезда — объёмная фигура по контуру картинки, у неё один кадр"],
  ["majesticStandard", "Как на сервере: этот лист не уезжает, в игре — арена сервера."],
]);

// Ползунки положения картинки: ключ, слова для aria, слова шага, ключ пределов, шаг, вид значения
const SHIFT_ROWS = [
  ["rotate", "поворот картинки", "поворот", "rotate", 1, degreesText],
  ["offsetX", "сдвиг по горизонтали", "сдвиг", "offset", 0.01, offsetText],
  ["offsetY", "сдвиг по вертикали", "сдвиг", "offset", 0.01, offsetText],
];

const IMAGE_DEFAULTS = freezeRows([
  ["hint", COPY.image],
  ["animated", false],
  ["stillReason", COPY.sheetStill],
  ["aspect", 0],
  ["still", ""],
  ["fill", ""],
  ["fit", "contain"],
  ["caption", null],
  ["emptyCaption", ""],
  ["title", "Картинка"],
  ["dropSelf", false],
  ["onClear", null],
  ["clearLabel", ""],
  ["text", null],
]);

const SLOT_HINTS = freezeRows([
  ["screens", "Картинка встаёт в каждый экран целиком, прямо и в его пропорциях — на телевизорах, на экранах над залом и в студии."],
  ["signs", "Картинка встаёт на каждую табличку вместо надписи. Фон — цвет плашки таблички."],
  ["logos", "Эмблема встаёт на места логотипов зала с прозрачным фоном. Пол и столы по умолчанию выключены — включите их сами, если нужно."],
  ["posters", "Картинка встаёт в каждое полотно и плакат: «заполнить» — без полей, «вписать» — целиком."],
  ["mazeSign", "Своё название встаёт вместо MAZE BANK ARENA — объёмных букв над главным входом (буквы игры уходят, ваши встают плашкой на их место) и полосы на всех трёх стелах у площади. Фон «Как было» — только буквы, «Цвет» — табличка этим цветом. Свой текст едет в код для друга словами."],
  ["outLogos", "Своя эмблема встаёт вместо белого щита PANIC и знака Maze Bank над главным входом (их модели уходят, эмблема встаёт плашкой) и логотипа LOS SANTOS PANIC на стелах (он стирается фактурой панели). «Убрать» — без щита и знака, на стелах чистая панель."],
  ["outBanners", "Свой баннер (лучше вертикальный) встаёт на 18 полотен у арок, флаги стел, плакат шоу и полотна с игроками — каждое место включается отдельно."],
]);

const MAJESTIC_SLOT_HINTS = freezeRows([
  ["screens", "Картинка встаёт в каждый экран целиком, прямо и в его пропорциях — на табло по стенам, круглом экране над залом и телевизорах. Каждому экрану, монитору и планшету можно дать свою — «По одному»."],
  ["posters", "Картинка встаёт на каждую картину, фото и баннер включённых мест — плашкой поверх них, в пропорциях каждой. Каждой можно дать свою — «По одному»."],
  ["logos", "Эмблема встаёт на места логотипов зала с прозрачным фоном — и в центр зала на полу вместо крылатого знака («Эмблема в центре зала»)."],
]);

const SAME_AS_ALL = freezeRows([
  ["screens", "Как у всех экранов"],
  ["signs", "Как у всех табличек"],
  ["logos", "Как у всех эмблем"],
  ["posters", "Как у всех плакатов"],
  ["outLogos", "Как у всех логотипов"],
  ["outBanners", "Как у всех баннеров"],
]);



/* ---------- Малые фабрики ---------- */

// Обработчик «записать одно поле и подписать шаг»
const writer = (write, prefix) => (key, words) => (value) => write({ [key]: value }, `${prefix}: ${words}`);

// Строка списка действий; поле danger есть только у опасных
const act = (id, label, onClick, danger = false) => (danger ? { id, label, danger, onClick } : { id, label, onClick });

function splitOff(source, key) {
  const { [key]: taken, ...rest } = source;
  return [taken, rest];
}

function definedOnly(source) {
  return Object.fromEntries(Object.entries(source).filter((entry) => entry[1] !== undefined));
}

function colorField(label, value, onChange, extra) {
  return h(ColorField, { label, value, swatches: ARENA_SWATCHES, editable: true, onChange, ...extra });
}

// Ряд «цвет раздела / как в игре»: onChange получает цвет, onClear вызывает его же с null
function colourRowFor(spec) {
  const standard = ARENA_STANDARD_LABELS[spec.server];
  return h(ColourRow, {
    label: spec.label,
    value: sectionColour(spec.settings),
    colours: ARENA_SWATCHES,
    auto: standard,
    onChange: spec.apply,
    onClear: () => spec.apply(null),
    clearLabel: tr(standard).toLowerCase(),
  });
}

/* ---------- Правила: подписи, положение, цвета ---------- */

function slotDefaults(id, mode) {
  return normalizeSlotTransform({}, arenaSlotDefaults(id, mode));
}

function transformChanged(id, transform, mode) {
  const current = JSON.stringify(normalizeSlotTransform(transform, ARENA_SLOT_DEFAULTS[id]));
  return current !== JSON.stringify(slotDefaults(id, mode));
}

// Нетронутое положение переходит на умолчание нового вида, подогнанное руками остаётся
function transformFor(id, transform, mode) {
  const untouched = ["image", "text"].some((other) => !transformChanged(id, transform, other));
  return untouched ? slotDefaults(id, mode) : transform;
}

function sameAsAll(server, id) {
  const posters = server === "majestic" && id === "posters";
  return posters ? tr("Как у всех картин") : tr(SAME_AS_ALL[id] || "Как у всех");
}

const standardName = (server) => (server === "majestic" ? tr("Как на сервере") : tr("Как в игре"));

// Как называется вид элемента в списке экранов предмета
function describeLook(server, look) {
  switch (look.mode) {
    case "standard":
      return server === "majestic" ? tr("Свой: как на сервере") : tr("Свой: как в игре");
    case "image":
      return look.image.asset ? tr("Своя картинка") : tr("Своя картинка — не выбрана");
    case "colour":
      return tr("Свой цвет");
    case "text":
      return tr("Свой текст");
    case "hidden":
      return tr("Убрано");
    default:
      return tr("Свой вид");
  }
}

function elementState(ctx, key) {
  if (!arenaElementOwn(ctx.settings, key)) return sameAsAll(ctx.server, ctx.id);
  return describeLook(ctx.server, ctx.settings.elements[key]);
}

// Подпись строки места: включено ли, сколько полотен и сколько из них со своим видом
function placeCaption(ctx, place, elements) {
  const own = elements.filter((item) => arenaElementOwn(ctx.settings, item.key));
  if (!ctx.settings.places[place.id]) return tr("Выключено");
  if (elements.length > 1) {
    return own.length > 0 ? trFill("{0} шт. · своих {1}", elements.length, own.length) : trFill("{0} шт.", elements.length);
  }
  return own.length > 0 ? tr("Свой вид") : sameAsAll(ctx.server, ctx.id);
}

function moreTitle(colour, text) {
  const titles = [tr("Рисунок"), tr("Текст и рисунок"), tr("Цвет и рисунок"), tr("Цвет, текст и рисунок")];
  return titles[(colour ? 2 : 0) + (text ? 1 : 0)];
}

function sectionColour(settings) {
  return settings.mode === "colour" ? settings.colour : null;
}

function colourPatch(colour) {
  return colour ? { mode: "colour", colour } : { mode: "standard" };
}

function mazeSignCaption(settings) {
  switch (settings?.mode) {
    case "text":
      return normalizeEmblemText(settings.text).value.trim() || "MAZE BANK ARENA";
    case "image":
      return tr("Своя картинка");
    default:
      return "MAZE BANK ARENA";
  }
}

// Метка места: своя настройка элемента (если есть), её картинка и цвет
function markOf(settings, element) {
  const look = element && arenaElementOwn(settings, element.key) ? settings.elements[element.key] : null;
  const shared = settings.mode;
  let asset = "";
  if (look && look.mode === "image") asset = look.image.asset;
  else if (shared === "image") asset = settings.image?.asset || "";
  let colour = "";
  if (look && look.mode === "colour") colour = look.colour;
  else if (!look && shared === "colour") colour = settings.colour;
  return { asset, colour };
}

// Следующий номер по кругу: шаг назад из начала ведёт в конец, шаг вперёд из конца — в начало
function wrapIndex(index, by, length) {
  return (((index + by) % length) + length) % length;
}

/* ---------- Выбор файла картинки ---------- */

function notify(ctx, text, level) {
  ctx.onNotice?.(text, level);
}

function complain(ctx, error) {
  notify(ctx, String(error?.message || error), "error");
}

// Обычная картинка: первый кадр гифки (если был) уже подставлен в still
function saveStill(file, ctx, still) {
  return Promise.resolve(saveHangarEmblem(still?.file || file)).then((result) => {
    const [converted, saved] = splitOff(result, "converted");
    ctx.onImage(saved);
    if (still?.frames > 1) {
      notify(ctx, trFill("Гифка из {0} кадров встанет первым кадром: {1}", still.frames, tr(ctx.stillReason)), "info");
    }
    if (converted) notify(ctx, convertedImageText(converted), "info");
  });
}

function saveViaFrame(file, ctx, maybeLive) {
  if (!maybeLive) return saveStill(file, ctx, null);
  return Promise.resolve(firstFramePicture(file))
    .catch(() => null)
    .then((still) => saveStill(file, ctx, still));
}

function announceLive(ctx, live) {
  const [notice, saved] = splitOff(live, "notice");
  ctx.onImage(saved);
  notify(ctx, notice || trFill("Живой баннер: кадров — {0}, сменяются и в игре.", saved.animation.frames), "info");
}

// Каждый прежний await — один шаг цепочки .then, порядок onImage/onNotice тот же
function pickPicture(file, ctx) {
  const failed = (error) => complain(ctx, error);
  try {
    const maybeLive = /gif|png|webp/.test([file.name || "", file.type || ""].join(" ").toLowerCase());
    if (!(ctx.animated && maybeLive)) return saveViaFrame(file, ctx, maybeLive).catch(failed);
    return Promise.resolve(saveAnimatedPicture(file))
      .catch(() => null)
      .then((live) => (live ? announceLive(ctx, live) : saveViaFrame(file, ctx, maybeLive)))
      .catch(failed);
  } catch (error) {
    failed(error);
    return Promise.resolve();
  }
}

/* ---------- Мелкая разметка ---------- */

function Section(props) {
  const heading = props.heading === undefined ? props.title : props.heading;
  const help = props.help === undefined ? "" : props.help;
  const panelOwns = usePanelHelp(heading || !help ? [] : [help]);
  const parts = useHelp(panelOwns ? "" : help);
  const caption = heading ? h("h3", null, heading) : null;
  if (props.bare) {
    const lead = heading || parts.button
      ? h("div", { className: "arena-subhead" }, heading ? h("p", { className: "items-editor-title" }, heading) : null, parts.button)
      : null;
    return h("div", { className: "recolor-subsection items-editor", "data-arena-section": props.id }, lead, parts.note, props.children);
  }
  const tools = h("span", { className: "arena-section-tools" }, props.toggle ?? null, parts.button);
  const head = props.toggle || parts.button ? h("header", { className: "fx-section-head arena-heading" }, caption || h("span"), tools) : caption;
  const frame = { className: "ui-panel fx-section recolor-section", "aria-label": props.title, "data-arena-section": props.id };
  return h("section", frame, head, parts.note, props.children);
}

function SwitchRow(props) {
  const note = props.hint ? h("small", null, props.hint) : null;
  const control = h(Switch, { checked: props.checked, label: props.title, onChange: props.onChange });
  return h("label", { className: "fx-switch" }, h("span", null, h("b", null, props.title), note), control);
}

function PlaceMark(props) {
  const mark = markOf(props.settings, props.element);
  const own = useHangarEmblemUrl(mark.asset);
  const game = useElementPicture(props.server, props.section, props.element);
  const url = own || (mark.colour ? "" : game);
  if (!url && !mark.colour) return null;
  const frame = {
    className: props.off ? "arena-place-mark is-off" : "arena-place-mark",
    "aria-hidden": "true",
    style: mark.colour ? { background: mark.colour } : undefined,
  };
  return h("span", frame, url ? h("img", { src: url, alt: "" }) : null);
}

/* ---------- Картинка ---------- */

// Подпись под картинкой: имя файла и число кадров живой гифки
function pictureCaption(image) {
  if (!image.asset) return "";
  const frames = image.animation ? ` · ${trFill("гифка, кадров: {0}", image.animation.frames)}` : "";
  return (image.name || tr("Своя картинка")) + frames;
}

export function ImageField(props) {
  useTr();
  const url = useHangarEmblemUrl(props.image.asset);
  const o = { ...IMAGE_DEFAULTS, ...definedOnly(props) };
  const picked = Boolean(props.image.asset);
  const ratio = picked && props.image.width && props.image.height ? props.image.width / props.image.height : 16 / 9;
  const take = (file) =>
    pickPicture(file, { animated: o.animated, stillReason: o.stillReason, onImage: props.onImage, onNotice: props.onNotice });

  const group = {
    title: o.title ? tr(o.title) : "",
    help: o.title ? tr(o.hint) : null,
    label: o.title ? "" : props.label,
    plain: true,
    "data-arena-picture": "",
  };
  const picture = {
    label: props.label,
    src: picked ? url : "",
    current: o.still,
    fill: picked ? "" : o.fill,
    aspect: o.aspect || ratio,
    fit: o.fit,
    caption: o.caption ?? pictureCaption(props.image),
    empty: tr("Своя картинка"),
    emptyCaption: o.emptyCaption || undefined,
    hint: tr(o.hint),
    accept: HANGAR_EMBLEM_ACCEPT,
    dropSelf: o.dropSelf,
    onFile: take,
    onClear: o.onClear,
    clearLabel: o.clearLabel,
    text: picked ? null : o.text,
  };
  return h(ListGroup, group, h(SurfacePicture, picture), props.children);
}

function SurfaceSection(props) {
  useTr();
  const title = arenaSectionLabel(props.server, props.id);
  const projected = arenaSurfaceProjected(props.server, props.id, props.settings);
  const finish = {
    rows: true,
    title: "",
    baseLabel: ARENA_STANDARD_LABELS[props.server],
    label: title,
    settings: props.settings,
    /* Площадь красится только цветом (узор и картинка растянулись бы по всей земле блока). */
    modes: props.id === "plaza" ? surfaceModeOptions(props.server).filter(([mode]) => mode === "standard" || mode === "colour") : surfaceModeOptions(props.server),
    swatches: ARENA_SWATCHES,
    surface: projected ? "wall" : "sheet",
    studio: surfaceStudio(props.server, props.id),
    shadeLabel: projected ? null : tr("Светотень листа"),
    hints: props.server === "majestic" ? { standard: tr(COPY.majesticStandard) } : {},
    onNotice: props.onNotice,
    gifStill: tr("стены, пол, потолок и фасад арены — общие листы модели зала, клипов анимации у них нет; живая гифка — на полотнах по одному (картины, баннеры, экраны)"),
    onChange: (patch, label) => props.onSurface(props.id, patch, label),
  };
  const effect = {
    label: tr("Цвет"),
    subject: title,
    value: props.settings.look,
    swatches: ARENA_SWATCHES,
    modes: EFFECT_MODES,
    directionLabels: { along: tr("Вдоль листа"), across: tr("Поперёк листа"), height: tr("Снизу вверх") },
    hints: { shimmer: tr("Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный.") },
    onChange: (look, label) => props.onSurface(props.id, { look }, label),
  };
  const inner = props.settings.mode === "colour" ? h(ColourEffectField, effect) : false;
  return h(Section, { id: props.id, title, heading: null }, h(FinishField, finish, inner));
}

/* ---------- Подгонка и текст ---------- */

function TransformFields(props) {
  useTr();
  const title = props.label || ARENA_SECTION_LABELS[props.id];
  const transform = props.transform;
  const fresh = normalizeSlotTransform({}, ARENA_SLOT_DEFAULTS[props.id]);
  const moved = SHIFT_ROWS.some((row) => transform[row[0]] !== fresh[row[0]]);
  const [open, setOpen] = useState(moved);
  const edit = writer(
    (values, words) => props.onTransform(normalizeSlotTransform({ ...transform, ...values }, ARENA_SLOT_DEFAULTS[props.id]), words),
    title,
  );

  const backgrounds = [{ value: "colour", label: tr("Цвет") }, { value: "keep", label: tr("Как было") }];
  if (props.id === "logos" || props.id === "screens") backgrounds.push({ value: "clear", label: tr("Прозрачный") });
  const fitProps = {
    fit: transform.fit,
    onFit: edit("fit", "как вписать"),
    label: `${title}: как вписать картинку`,
    zoom: {
      value: transform.scale,
      min: SLOT_LIMITS.scale[0],
      max: SLOT_LIMITS.scale[1],
      step: 0.05,
      format: scaleText,
      ariaLabel: `${title}: размер картинки`,
      onChange: edit("scale", "размер картинки"),
    },
    "data-arena-transform": props.id,
  };

  // поля вокруг картинки занимают постоянные места: появление полей не пересоздаёт список ниже
  const margins = transform.fit === "contain" || transform.scale < 1 || moved;
  const around = margins
    ? h(SegmentedControl, {
        label: `${title}: фон вокруг картинки`,
        size: "sm",
        options: backgrounds,
        value: transform.background,
        onChange: edit("background", "фон"),
      })
    : null;
  const tint = margins && transform.background === "colour"
    ? colorField(tr("Цвет фона"), transform.backgroundColour, edit("backgroundColour", "цвет фона"))
    : null;

  const labels = [tr("Поворот"), tr("Сдвиг вправо"), tr("Сдвиг вниз")];
  const sliders = SHIFT_ROWS.map((row, at) => {
    const span = SLOT_LIMITS[row[3]];
    return h(Slider, {
      key: row[0],
      label: labels[at],
      ariaLabel: `${title}: ${row[1]}`,
      value: transform[row[0]],
      min: span[0],
      max: span[1],
      step: row[4],
      format: row[5],
      onChange: edit(row[0], row[2]),
    });
  });
  const summary = moved
    ? [degreesText(transform.rotate), offsetText(transform.offsetX), offsetText(transform.offsetY)].join(" · ")
    : tr("по центру");
  const head = h(ListRow, {
    title: tr("Поворот и сдвиг"),
    caption: summary,
    trailing: open ? h(CaretDown, { "aria-hidden": "true" }) : h(CaretRight, { "aria-hidden": "true" }),
    expanded: open,
    onOpen: () => setOpen(!open),
  });
  const list = h("div", { className: "ui-list-group-list" }, head, open ? h(ListSub, null, sliders) : null);
  return h(SurfaceFit, fitProps, around, tint, list);
}

function SignTextFields(props) {
  useTr();
  const title = ARENA_SECTION_LABELS[props.id];
  const text = props.settings.text;
  const patchText = (values, label) =>
    props.set({ text: normalizeEmblemText({ ...text, ...values }) }, `${title}: ${label.replace(/^Надпись: /, "")}`);
  const patch = writer(patchText, "Надпись");
  const field = { label: tr("Надпись"), value: text.value, maxLength: EMBLEM_TEXT_LIMIT, onChange: patch("value", "слова") };
  return h(
    "div",
    { className: "recolor-subsection", "data-arena-text": props.id },
    h(TextField, field),
    h(FontControls, { text, edit: { patchText }, onNotice: props.onNotice }),
    colorField(tr("Цвет букв"), text.colour, patch("colour", "цвет букв")),
    h(OutlineControl, { value: text.outline, onChange: patch("outline", "обводка") }),
  );
}

/* ---------- Вид: картинка, текст, цвет (props — свойства LookFields) ---------- */

const lookTitle = (p) => p.label || arenaSectionLabel(p.server, p.id);
const lookAllows = (p, mode) => (p.modes || arenaSectionModes(p.server, p.id)).includes(mode);
const lookIsPicture = (p) => p.look.mode === "image" && Boolean(p.look.image?.asset);
const lookIsPlaced = (p) => lookIsPicture(p) || p.look.mode === "text";
const lookGoto = (p, mode, words) => () => p.set({ mode }, `${lookTitle(p)}: ${words}`);

// Режим, в который вид возвращается после «без цвета»
const lookBack = (p) => (p.look.image?.asset || !lookAllows(p, "standard") ? "image" : "standard");

// Что делает «снять» с картинки или текста и как это называется
function lookUndo(p) {
  if (p.dropOwn) return p.dropOwn;
  if (lookAllows(p, "standard")) return lookGoto(p, "standard", standardName(p.server).toLowerCase());
  return lookAllows(p, "hidden") ? lookGoto(p, "hidden", tr("убрать")) : null;
}

function lookUndoLabel(p) {
  if (p.dropOwn) return sameAsAll(p.server, p.id);
  if (lookAllows(p, "standard")) return standardName(p.server);
  return lookIsPicture(p) ? tr("Убрать картинку") : tr("Убрать текст");
}

// Подпись над картинкой-зоной: имя файла или состояние вида
function zoneCaption(p) {
  const named = lookIsPicture(p) ? p.look.image.name || tr("Своя картинка") : "";
  if (named) return named;
  const byMode = { colour: tr("Свой цвет"), text: tr("Свой текст"), hidden: tr("Убрано") };
  return byMode[p.look.mode] ?? "";
}

function putLookImage(p, image) {
  const next = { mode: "image", image, transform: transformFor(p.id, p.look.transform, "image") };
  p.set(next, `${lookTitle(p)}: картинка`);
}

function lookImage(p) {
  const animated = p.animated ?? false;
  const caption = zoneCaption(p);
  let clear = null;
  if (lookIsPlaced(p)) clear = lookUndo(p);
  else if (p.look.mode === "colour") clear = lookGoto(p, lookBack(p), tr("без цвета"));
  return h(ImageField, {
    title: "",
    label: `${lookTitle(p)}: картинка`,
    image: lookIsPicture(p) ? p.look.image : NO_IMAGE,
    fill: p.look.mode === "colour" ? p.look.colour : "",
    caption: caption && `${p.captionPrefix ?? ""}${caption}`,
    animated,
    stillReason: p.stillReason ?? COPY.sheetStill,
    hint: p.hint || (animated ? COPY.live : COPY.image),
    onNotice: p.onNotice,
    onImage: (image) => putLookImage(p, image),
    onClear: clear,
    clearLabel: lookIsPlaced(p) ? lookUndoLabel(p) : tr("без цвета"),
    text: p.look.mode === "text" && p.look.text ? { value: p.look.text.value, colour: p.look.text.colour } : null,
  });
}

// Действия под полями: положение, как в игре, добавленные снаружи, убрать
function lookActions(p) {
  const reset = () => p.set({ transform: slotDefaults(p.id, p.look.mode) }, `${lookTitle(p)}: положение по умолчанию`);
  const toStandard = lookGoto(p, "standard", standardName(p.server).toLowerCase());
  return [
    lookIsPlaced(p) && transformChanged(p.id, p.look.transform, p.look.mode) && act("transform", tr("Положение по умолчанию"), reset),
    lookAllows(p, "standard") && p.look.mode !== "standard" && act("standard", standardName(p.server), toStandard),
    ...(p.actions ?? []),
    lookAllows(p, "hidden") && p.look.mode !== "hidden" && act("hidden", tr("Убрать"), lookGoto(p, "hidden", tr("убрать")), true),
  ];
}

// Строка «Свой цвет» с раскрывающейся палитрой
function lookColourRow(p, palette, setPalette) {
  const mine = p.look.mode === "colour";
  const trailing = (
    <>
      {h(ListSwatch, { colour: mine ? p.look.colour : null })}
      {palette ? h(CaretDown, { "aria-hidden": "true" }) : h(CaretRight, { "aria-hidden": "true" })}
    </>
  );
  return h(ListRow, {
    icon: h(Palette),
    title: tr("Свой цвет"),
    caption: mine ? p.look.colour.toUpperCase() : null,
    trailing,
    expanded: palette,
    onOpen: () => setPalette(!palette),
    onClear: mine ? lookGoto(p, lookBack(p), tr("без цвета")) : null,
    clearLabel: tr("без цвета"),
  });
}

const lookPalette = (p) =>
  h(
    ListSub,
    null,
    colorField(tr("Цвет"), p.look.colour, (colour) => p.set({ mode: "colour", colour }, `${lookTitle(p)}: цвет`), {
      ariaLabel: `${lookTitle(p)}: цвет`,
    }),
  );

const lookTextRow = (p) =>
  h(NavRow, {
    icon: h(TextT),
    title: tr("Свой текст"),
    "aria-label": `${lookTitle(p)}: ${tr("свой текст")}`,
    onOpen: () => p.set({ mode: "text", transform: transformFor(p.id, p.look.transform, "text") }, `${lookTitle(p)}: ${tr("свой текст")}`),
  });

function lookStudioRow(p, live) {
  return h(StudioPictureButton, {
    getSurface: () => arenaStudioSurface({ server: p.server, id: p.id, element: p.element ?? null, title: arenaSectionLabel(p.server, p.id), live }),
    image: lookIsPicture(p) && !p.look.image.animation ? p.look.image : null,
    onImage: (image) => putLookImage(p, image),
    onNotice: p.onNotice,
    slug: `${lookTitle(p)}: картинка`,
    label: tr("Нарисовать в студии"),
    caption: tr("Кисть, слои, текст"),
  });
}

function LookFields(props) {
  useTr();
  const studio = useStudioLive();
  const [paletteShown, setPaletteShown] = useState(false);
  const { id, look } = props;
  const allowsColour = lookAllows(props, "colour");
  const allowsImage = lookAllows(props, "image");
  const allowsText = lookAllows(props, "text");
  const typing = look.mode === "text";
  const offersText = allowsText && !typing;

  const pictureZone = allowsImage ? lookImage(props) : null;
  const signFields =
    typing && look.text
      ? h(SignTextFields, { id, onNotice: props.onNotice, set: props.set, settings: look })
      : null;
  const fitting = lookIsPlaced(props)
    ? h(TransformFields, {
        id,
        label: props.label ?? "",
        onTransform: (transform, words) => props.set({ transform }, words),
        transform: look.transform,
      })
    : null;
  const extras =
    allowsColour || allowsText || allowsImage
      ? h(
          ListGroup,
          { "data-arena-more": id, title: moreTitle(allowsColour, offersText) },
          allowsColour ? lookColourRow(props, paletteShown, setPaletteShown) : null,
          allowsColour && paletteShown ? lookPalette(props) : null,
          offersText ? lookTextRow(props) : null,
          allowsImage ? lookStudioRow(props, studio) : null,
        )
      : null;

  return (
    <>
      {pictureZone}
      {signFields}
      {fitting}
      {extras}
      {props.children ?? null}
      {h(ActionRows, { actions: lookActions(props), label: lookTitle(props) })}
    </>
  );
}

/* ---------- Элемент и места ---------- */

// Вид полотна: свой из настроек или копия общего вида раздела
function elementLook(settings, modes) {
  const { mode, colour, image, transform, text } = settings;
  return { mode: modes.includes(mode) ? mode : modes[0], colour, image, transform, ...(text ? { text } : {}) };
}

function ElementEditor(props) {
  useTr();
  const element = props.element;
  const modes = arenaElementModes(props.server, props.id, element);
  const own = arenaElementOwn(props.settings, element.key);
  const look = own ? props.settings.elements[element.key] : elementLook(props.settings, modes);
  const title = arenaSectionLabel(props.server, props.id);
  const commit = (elements, places, words) =>
    props.onSection(props.id, { elements, places }, `${title}: ${element.label.toLowerCase()} — ${words}`);
  const set = (values, words) => {
    const places = props.settings.places;
    const wake = places[element.place] ? places : { ...places, [element.place]: true };
    const elements = { ...props.settings.elements, [element.key]: { ...look, ...values } };
    commit(elements, wake, String(words || "").replace(/^[^:]+: /, ""));
  };
  const follow = () => {
    const others = Object.entries(props.settings.elements).filter((entry) => entry[0] !== element.key);
    commit(Object.fromEntries(others), props.settings.places, tr("как все"));
  };
  const everyone = sameAsAll(props.server, props.id);
  const stillPanel = Boolean(element.panel) && !arenaPanelsAnimated(props.server);
  const lookProps = {
    server: props.server,
    id: props.id,
    look,
    set,
    onNotice: props.onNotice,
    label: element.label,
    element,
    modes: element.panel ? modes : null,
    animated: Boolean(element.panel) && arenaPanelsAnimated(props.server),
    hint: stillPanel ? COPY.panel : null,
    stillReason: stillPanel ? COPY.majesticStill : COPY.sheetStill,
    captionPrefix: own ? "" : `${everyone} · `,
    actions: [own && act("follow", everyone, follow)],
    dropOwn: own ? follow : null,
  };
  const frame = { className: "recolor-subsection arena-element-editor", "data-arena-element": element.key };
  return h("div", frame, h(LookFields, lookProps));
}

function placeRow(props, place) {
  const elements = arenaPlaceElements(props.server, props.id, place.id);
  const media = h(PlaceMark, {
    server: props.server,
    section: props.id,
    element: elements[0],
    settings: props.settings,
    off: !props.settings.places[place.id],
  });
  const hover = props.onHover ? (on) => props.onHover(on ? { section: props.id, place: place.id } : null) : null;
  return h(ArenaRow, {
    key: place.id,
    media,
    title: place.label,
    caption: placeCaption(props, place, elements),
    "data-arena-place": place.id,
    onOpen: () => props.onOpen(place.id),
    onHover: hover,
  });
}

function PlaceRows(props) {
  useTr();
  const places = arenaPlaces(props.server, props.id);
  if (places.length === 0) return null;
  const shown = places.filter((place) => props.settings.places[place.id]).length;
  const heading = h("h4", { className: "recolor-subhead" }, tr("Места"), " ", h("small", null, trFill("{0} из {1}", shown, places.length)));
  const frame = {
    className: "recolor-subsection arena-places",
    role: "group",
    "aria-label": `${arenaSectionLabel(props.server, props.id)}: места`,
  };
  return h("div", frame, heading, ...places.map((place) => placeRow(props, place)));
}

function PlacePage(props) {
  useTr();
  const title = arenaSectionLabel(props.server, props.id);
  const shown = props.settings.places[props.place.id];
  const flip = (value) => {
    const verb = value ? tr("вкл.") : tr("выкл.");
    const places = { ...props.settings.places, [props.place.id]: value };
    props.onSection(props.id, { places }, `${title}: ${props.place.label.toLowerCase()} ${verb}`);
  };
  const toggle = {
    title: props.place.label,
    hint: shown ? tr("Место показано в игре") : tr("Место убрано из игры"),
    checked: Boolean(shown),
    onChange: flip,
  };
  const editor = props.element
    ? h(ElementEditor, {
        key: props.element.key,
        server: props.server,
        id: props.id,
        settings: props.settings,
        element: props.element,
        onSection: props.onSection,
        onNotice: props.onNotice,
      })
    : null;
  return h("div", { className: "recolor-subsection arena-place", "data-arena-place": props.place.id }, h(SwitchRow, toggle), editor);
}

// Стрелки в шапке страницы места из нескольких полотен
function pagerArrows(step) {
  const arrows = [
    [h(CaretLeft, { "aria-hidden": "true" }), tr("Предыдущий"), -1],
    [h(CaretRight, { "aria-hidden": "true" }), tr("Следующий"), 1],
  ];
  const buttons = arrows.map(([icon, name, by]) =>
    h(Button, { key: name, size: "sm", variant: "ghost", className: "items-page-icon", icon, ariaLabel: name, title: name, onClick: () => step(by) }),
  );
  return h("span", { className: "items-page-actions" }, ...buttons);
}

// После смены выбора страница места подстраивается под выбранное полотно
function settlePage(env, selected, setPage) {
  if (selected) {
    if (!env.aim) return;
    const target = arenaSlotElements(env.server, env.id).find((item) => item.key === selected);
    if (target && target.place) setPage(target.place);
    return;
  }
  setPage((current) => {
    if (!current) return current;
    const crowded = arenaPlaceElements(env.server, env.id, current).length > 1;
    return crowded ? "" : current;
  });
}

// Страница места и выбранное полотно; без внешнего выбора полотно хранится здесь
function useSlotPage(args) {
  const [page, setPage] = useState("");
  const [own, setOwn] = useState("");
  const selected = args.onSelect ? args.chosen : own;
  const setSelected = args.onSelect || setOwn;
  const { server, id, aim } = args;
  useEffect(() => settlePage({ server, id, aim }, selected, setPage), [aim, selected, server, id]);
  return { page, setPage, selected, setSelected };
}

function overNote(props) {
  const over = props.over ?? [];
  if (over.length === 0) return false;
  const limit = arenaPanelFaceLimit(props.server);
  const text = tr("Своих полотен больше, чем встанет в игру (до {0} сторон на арену): {1} — не встанут. Сделайте лишние «как все» или общим видом.")
    .replace("{0}", () => limit)
    .replace("{1}", () => over.join(", "));
  return h("p", { className: "fx-hint is-warning", role: "status" }, text);
}

// Страница одного места: переключатель места и редактор выбранного полотна
function renderPlacePage(props, nav, place) {
  const elements = arenaPlaceElements(props.server, props.id, place.id);
  const keys = elements.map((item) => item.key);
  const index = Math.max(keys.indexOf(nav.selected), 0);
  const element = elements[index] ?? null;
  const several = elements.length > 1;
  const sectionName = arenaSectionLabel(props.server, props.id);

  const frame = {
    actions: several ? pagerArrows((by) => nav.setSelected(keys[wrapIndex(index, by, elements.length)])) : null,
    backLabel: tr("Ко всем местам"),
    label: several ? element.label : place.label,
    note: several ? `${place.label} · ${trFill("{0} из {1}", index + 1, elements.length)}` : sectionName,
    onBack: () => {
      nav.setPage("");
      nav.setSelected("");
    },
  };
  const hintLine = several ? tr("Соседнее — стрелками в шапке или щелчком в кадре") : null;
  const body = h(
    Section,
    { heading: null, help: hintLine, id: props.id, title: sectionName },
    overNote(props),
    h(PlacePage, { ...props, element, place }),
  );
  return h(PanelPage, frame, body);
}

// Все места сразу: камера, общий вид раздела и строки мест
function renderOverview(props, nav) {
  const title = arenaSectionLabel(props.server, props.id);
  const focus = props.focus ?? null;
  const camera = props.onFocus
    ? h(SegmentedControl, {
        label: `${title}: камера`,
        size: "sm",
        options: ARENA_SIGN_VIEWS,
        value: ARENA_SIGN_VIEWS.some((item) => item.value === focus) ? focus : "all",
        onChange: props.onFocus,
      })
    : null;
  // место открыто строкой — камера к нему; место из нескольких полотен открывается первым из них
  const openPlace = (placeId) => {
    const crowd = arenaPlaceElements(props.server, props.id, placeId);
    nav.setPage(placeId);
    return crowd.length > 1 ? nav.setSelected(crowd[0].key) : props.onFly?.({ section: props.id, place: placeId });
  };
  const rows = h(PlaceRows, { server: props.server, id: props.id, settings: props.settings, onOpen: openPlace, onHover: props.onHover ?? null });
  const look = {
    server: props.server,
    id: props.id,
    look: props.settings,
    set: (values, label) => props.onSection(props.id, values, label),
    onNotice: props.onNotice,
  };
  const hintText = (props.server === "majestic" && MAJESTIC_SLOT_HINTS[props.id]) || SLOT_HINTS[props.id] || "";
  return h(
    Section,
    { id: props.id, title, heading: tr("Все сразу"), help: tr(hintText) },
    camera,
    h(LookFields, look, overNote(props), rows),
  );
}

function SlotSection(props) {
  useTr();
  const nav = useSlotPage({
    server: props.server,
    id: props.id,
    aim: props.aim ?? 0,
    chosen: props.selected ?? "",
    onSelect: props.onSelect ?? null,
  });
  const place = nav.page ? arenaPlaces(props.server, props.id).find((item) => item.id === nav.page) : null;
  return place ? renderPlacePage(props, nav, place) : renderOverview(props, nav);
}

/* ---------- Цвет без картинки: выходы, подсветка, кресла, автоматы ---------- */

function ColourOnly(props) {
  useTr();
  const standard = ARENA_STANDARD_LABELS[props.server];
  const apply = (colour) =>
    props.onSection(props.id, colourPatch(colour), `${props.title}: ${colour ? tr("цвет") : tr(standard).toLowerCase()}`);
  const row = colourRowFor({ label: props.colourLabel, settings: props.settings, server: props.server, apply });
  return h(ListGroup, { label: props.title, "data-arena-colour": props.id }, row);
}

// Раздел с одним цветом: описание берётся из таблицы разделов
const COLOUR_SECTIONS = {
  exits: () => ({
    title: tr("Знаки выхода"),
    help: tr("Зелёные таблички «Выход» с бегущим человечком и стрелками: зелёное становится выбранным цветом, буквы и рамки остаются светлыми."),
    colourLabel: tr("Цвет знаков"),
  }),
  lights: () => ({
    title: tr("Подсветка"),
    help: tr("Светящиеся полосы и нарисованный свет залов Majestic — тоном выбранного цвета."),
    colourLabel: tr("Цвет"),
  }),
};

function ColourSection(props) {
  useTr();
  const spec = COLOUR_SECTIONS[props.id]();
  const inner = h(ColourOnly, {
    server: props.server,
    id: props.id,
    title: spec.title,
    settings: props.settings,
    onSection: props.onSection,
    colourLabel: spec.colourLabel,
  });
  return h(Section, { id: props.id, title: spec.title, help: spec.help }, inner);
}

function ObjectsSection(props) {
  useTr();
  const put = (values, words) => props.onSection("objects", values, words);
  const items = ARENA_OBJECTS.map((item) =>
    h(SwitchRow, {
      key: item.id,
      title: item.label,
      hint: item.hint,
      checked: props.settings[item.id] !== "hide",
      onChange: (on) => put({ [item.id]: on ? "show" : "hide" }, `${item.label}: ${on ? tr("показать") : tr("убрать")}`),
    }),
  );
  const ownColour = h(SwitchRow, {
    title: tr("Свой цвет банкоматов"),
    checked: props.settings.atms === "colour",
    onChange: (on) => put({ atms: on ? "colour" : "show" }, on ? tr("Банкоматы: свой цвет") : tr("Банкоматы: как в игре")),
  });
  const colour = colorField(tr("Цвет банкоматов"), props.settings.atmsColour, writer(put, "Банкоматы")("atmsColour", "цвет"));
  const help = [
    tr("«Убрать» прячет только автоматы этой арены. Пройти сквозь место, где они стояли, по-прежнему нельзя — стена столкновений зала остаётся."),
    tr("Банкомат — модель игры: свой цвет будет у таких банкоматов по всему штату"),
  ];
  return h(
    Section,
    { id: "objects", title: tr("Торговые автоматы"), help },
    ...items,
    props.settings.atms !== "hide" ? ownColour : null,
    props.settings.atms === "colour" ? colour : null,
  );
}

function SeatsSection(props) {
  useTr();
  const set = (values, label) => props.onSection("seats", values, label);
  const standard = tr(ARENA_STANDARD_LABELS[props.server]);
  const hidden = props.settings.mode === "hidden";
  const gta = props.server === "gta5rp";
  const bare = props.bare ?? false;
  const picker = h(
    "div",
    { className: "arena-group", "data-arena-group": "model" },
    h(ChairPicker, {
      title: tr("Модель"),
      label: tr("Кресла: модель"),
      value: props.settings.model || "stadium",
      onChange: writer(set, "Кресла")("model", "модель"),
    }),
  );
  const apply = (colour) => set(colourPatch(colour), colour ? "Кресла: цвет" : `Кресла: ${standard.toLowerCase()}`);
  const row = colourRowFor({ label: tr("Цвет кресел"), settings: props.settings, server: props.server, apply });
  const actions = [
    hidden && act("standard", standard, () => set({ mode: "standard" }, `Кресла: ${standard.toLowerCase()}`)),
    !hidden && arenaSectionModes(props.server, "seats").includes("hidden") && act("hidden", tr("Убрать"), () => set({ mode: "hidden" }, "Кресла: убрать"), true),
  ];
  const help = gta
    ? tr("Другая модель — штатное кресло GTA встаёт на места кресел зала (правкой интерьера арены, кресла остальной карты не меняются). Свой цвет — копией кресла только для зала: такие же кресла в других интерьерах остаются штатными. «Убрать» прячет кресла зала.")
    : tr("Кресла Majestic — ряды в моделях залов вместе со ступенями: их можно перекрасить, но не убрать и не заменить.");
  return h(
    Section,
    { id: "seats", title: tr("Кресла"), heading: null, bare, help },
    gta && !hidden ? picker : null,
    !bare && !hidden ? h(ListGroup, { label: tr("Кресла: цвет"), "data-arena-group": "look" }, row) : null,
    !bare ? h(ActionRows, { label: tr("Кресла"), actions }) : null,
  );
}

/* ---------- Звезда ---------- */

function starHelp(mode) {
  switch (mode) {
    case "image":
      return tr("Фигура встаёт в середину зала лицом ко входу, на место реквизита шоу «Fame or Shame». Модель собирается по правилам игры: лист 512² DXT5 с полной цепочкой мип-уровней, движение — клипом, как у штатных крутящихся моделей GTA.");
    case "standard":
      return tr("Стандарт GTA: в середине зала — штатный реквизит шоу «Fame or Shame». Своя картинка (PNG с прозрачным фоном) станет объёмной фигурой на подставке.");
    default:
      return tr("Реквизита шоу в середине зала нет.");
  }
}

// Ползунки фигуры: ключ, подпись, шаг, вид значения, слова шага
const starGauges = () => [
  ["size", tr("Высота фигуры"), 0.1, metresText, "размер"],
  ["depth", tr("Толщина"), 1, centimetresText, "толщина"],
  ["speed", tr("Скорость"), 0.1, speedText, "скорость"],
  ["height", tr("Высота подъёма"), 0.1, metresText, "высота подъёма"],
];

function StarSection(props) {
  useTr();
  const settings = props.settings;
  const set = (values, label) => props.onSection("star", values, label);
  const edit = writer(set, "Звезда");
  const standardLabel = tr(ARENA_STANDARD_LABELS[props.server]);
  const toStandard = () => set({ mode: "standard" }, "Звезда: как в игре");
  const imaged = settings.mode === "image";
  const sliders = starGauges().map((row) =>
    h(Slider, {
      key: row[0],
      label: row[1],
      value: settings[row[0]],
      min: ARENA_STAR_LIMITS[row[0]][0],
      max: ARENA_STAR_LIMITS[row[0]][1],
      step: row[2],
      format: row[3],
      onChange: edit(row[0], row[4]),
    }),
  );
  const stand = h(Select, {
    label: tr("Подставка"),
    ariaLabel: tr("Звезда: подставка"),
    value: settings.stand,
    options: STAR_STAND_OPTIONS,
    onChange: edit("stand", "подставка"),
  });
  const motion = h(SegmentedControl, {
    label: tr("Движение"),
    size: "sm",
    options: STAR_ANIMATION_OPTIONS,
    value: settings.animation,
    onChange: edit("animation", "движение"),
  });
  const picture = {
    title: "",
    label: tr("Звезда: картинка"),
    image: imaged ? settings.image : NO_IMAGE,
    aspect: 1,
    emptyCaption: settings.mode === "hidden" ? tr("Убрано") : standardLabel,
    onNotice: props.onNotice,
    hint: tr("PNG с прозрачным фоном: непрозрачная часть станет объёмной фигурой. JPEG — прямоугольником. Большая картинка уменьшится сама."),
    stillReason: COPY.starStill,
    onImage: (image) => set({ mode: "image", image }, "Звезда: картинка"),
    onClear: imaged ? toStandard : null,
    clearLabel: standardLabel,
  };
  const toggle = imaged
    ? h(
        Button,
        { size: "sm", variant: "ghost", "aria-pressed": props.focused, onClick: () => props.onFocus(!props.focused) },
        props.focused ? tr("Вернуть камеру") : tr("Камера к звезде"),
      )
    : null;
  const endings = [
    settings.mode !== "standard" && act("standard", standardLabel, toStandard),
    settings.mode !== "hidden" && act("hidden", tr("Убрать"), () => set({ mode: "hidden" }, "Звезда: убрать"), true),
  ];
  return h(
    Section,
    { id: "star", title: tr("Звезда"), help: starHelp(settings.mode), toggle },
    h(ImageField, picture),
    imaged ? stand : null,
    imaged ? sliders[0] : null,
    imaged ? sliders[1] : null,
    imaged ? motion : null,
    imaged && settings.animation !== "none" ? sliders[2] : null,
    imaged && ["bounce", "levitate"].includes(settings.animation) ? sliders[3] : null,
    h(ActionRows, { label: tr("Звезда"), actions: endings }),
  );
}

/* ---------- Экраны выбранного предмета ---------- */

// Правка одного экрана расходится на все экраны предмета, если их несколько
function spreadEdit(props, element, id, values, label) {
  const targets = props.targets ?? props.elements;
  const ownKey = element?.key;
  if (id !== "screens" || !values.elements || !ownKey || targets.length < 2) return props.onSection(id, values, label);
  const look = values.elements[ownKey];
  const seed = { elements: { ...values.elements }, places: { ...(values.places || props.settings.places) } };
  const done = targets.reduce((acc, target) => {
    if (look) {
      acc.elements[target.key] = look;
      acc.places[target.place] = true;
    } else {
      delete acc.elements[target.key];
    }
    return acc;
  }, seed);
  return props.onSection(id, { ...values, ...done }, `${label} (${tr("{0} экр.").replace("{0}", targets.length)})`);
}

function followScreen(props, item) {
  const others = Object.entries(props.settings.elements).filter((entry) => entry[0] !== item.key);
  const label = `${arenaSectionLabel(props.server, "screens")}: ${item.label.toLowerCase()} — ${tr("как все")}`;
  props.onSection("screens", { elements: Object.fromEntries(others), places: props.settings.places }, label);
}

function screenRow(props, item, activeKey, choose) {
  const picked = activeKey === item.key;
  const rowProps = {
    key: item.key,
    "aria-pressed": picked,
    caption: elementState({ id: "screens", server: props.server, settings: props.settings }, item.key),
    className: picked ? "is-selected" : "",
    "data-arena-screen": item.key,
    onOpen: () => choose(picked ? "" : item.key),
    title: item.label,
    trailing: picked ? h(Check, { "aria-hidden": "true" }) : null,
  };
  if (!arenaElementOwn(props.settings, item.key)) return h(NavRow, rowProps);
  return h(ListRow, {
    ...rowProps,
    clearLabel: sameAsAll(props.server, "screens"),
    onClear: () => followScreen(props, item),
  });
}

function ObjectScreens(props) {
  useTr();
  const [chosen, choose] = useState("");
  const elements = props.elements;
  const lone = elements.length === 1 ? elements[0].key : "";
  const activeKey = elements.some((item) => item.key === chosen) ? chosen : lone;
  const element = elements.find((item) => item.key === activeKey) || null;
  const list = elements.length > 1
    ? h(ListGroup, { label: tr("Экраны предмета") }, elements.map((item) => screenRow(props, item, activeKey, choose)))
    : false;
  const editor = element
    ? h(ElementEditor, {
        key: element.key,
        server: props.server,
        id: "screens",
        settings: props.settings,
        element,
        onSection: (id, values, label) => spreadEdit(props, element, id, values, label),
        onNotice: props.onNotice,
      })
    : null;
  return h("div", { className: "arena-item-screens", "data-arena-item-screens": true }, list, editor);
}

/* ---------- Панель арены: страницы по инструментам ---------- */

const overLabels = (project) => arenaPanelPlates(project).flatMap((plate) => (plate.over ? [plate.label] : []));

// Каждая страница получает общий контекст c и возвращает список узлов (пустой — раздела нет)
const PAGES = new Map();

PAGES.set("templates", (c) =>
  c.props.onTemplate
    ? [
        h(ArenaTemplates, { current: c.props.template ?? "", busy: c.props.templateBusy ?? "", onApply: c.props.onTemplate }),
        h(ActionRows, { label: c.standardLabel, actions: [!c.stock && act("standard", tr(c.standardLabel), c.props.onStandard)] }),
      ]
    : [],
);

PAGES.set("emblem", (c) => {
  const emblems = c.props.emblems ?? null;
  const section = h(EmblemSection, {
    edit: { ...emblems, setPlacing: c.props.onPlacing },
    kind: c.tool === "text" ? "text" : "image",
    sizeRange: ARENA_EMBLEM_SIZE,
    resetLabel: tr("На фасад"),
    onReset: () => c.decal && emblems.patch({ point: [...c.decal.point], normal: [...c.decal.normal], angle: 0 }, "Эмблема: на фасад"),
    onNotice: c.props.onNotice,
  });
  if (!(c.tool === "text" && c.settings.mazeSign && c.props.onTextPage)) return [section];
  const row = {
    title: h("span", { "data-audit-ignore": "caps" }, mazeSignCaption(c.settings.mazeSign)),
    caption: tr("Над главным входом и на стелах"),
    onOpen: () => c.props.onTextPage("mazeSign"),
  };
  return [h(Section, { id: "mazeSign-row", title: tr("Название арены") }, h(NavRow, row)), section];
});
PAGES.set("text", PAGES.get("emblem"));

PAGES.set("items", (c) => {
  const items = c.props.items;
  if (!items || !c.settings.screens) return [];
  const { server, settings, props } = c;
  const screens = (elements, targets) =>
    h(ObjectScreens, { server, onSection: props.onSection, onNotice: props.onNotice, settings: settings.screens, elements, targets });
  const seats = settings.seats ? () => h(SeatsSection, { server, settings: settings.seats, onSection: props.onSection, bare: true }) : null;
  const wired = {
    server,
    selection: items.selection, onSelect: items.onSelect, onScope: items.onScope, onShellPaint: items.onShellPaint,
    shots: items.shots, home: items.home, onTool: items.onTool, shellPaint: items.shellPaint, onFind: items.onFind,
    asset: items.asset, removed: items.removed, onRemove: items.onRemove, onRestore: items.onRestore,
    looks: settings.items, onLook: items.onLook, replace: settings.replace, screenSettings: settings.screens,
    onSection: props.onSection, onNotice: props.onNotice, renderScreens: screens, renderSeats: seats,
    onHover: items.onHover, partsOf: items.partsOf || null, onPiece: items.onPiece || null,
    onElement: items.onElement || null, onToggle: items.onToggle || null,
    surfaces: settings, onSurface: props.onSurface,
  };
  return [h(ItemsSection, wired)];
});

PAGES.set("layers", (c) => {
  const items = c.props.items;
  if (!items) return [];
  return [h(LayersSection, { server: c.server, removed: items.removed, onRemove: items.onRemove, onRestore: items.onRestore, onHover: items.onHover })];
});

PAGES.set("replace", (c) => {
  if (!c.settings.replace) return [];
  const { props } = c;
  return [
    h(ReplaceSection, {
      server: c.server,
      settings: c.settings.replace,
      onSection: props.onSection,
      onNotice: props.onNotice,
      selected: c.keyIn("replace"),
      onSelect: c.chooserFor("replace"),
      aim: props.aim ?? 0,
      onHover: props.onHover ?? null,
    }),
  ];
});

PAGES.set("star", (c) => {
  if (!c.settings.star) return [];
  const props = {
    server: c.server,
    settings: c.settings.star,
    onSection: c.props.onSection,
    onNotice: c.props.onNotice,
    focused: c.props.focus === "star",
    onFocus: (on) => c.props.onFocus(on ? "star" : null),
  };
  return [h(StarSection, props)];
});

// Страницы с одной секцией настроек: что рисовать, если настройки есть
const SINGLE_PAGES = {
  exits: (c, settings) => h(ColourSection, { id: "exits", server: c.server, settings, onSection: c.props.onSection }),
  lights: (c, settings) => h(ColourSection, { id: "lights", server: c.server, settings, onSection: c.props.onSection }),
  objects: (c, settings) => h(ObjectsSection, { settings, onSection: c.props.onSection }),
  seats: (c, settings) => h(SeatsSection, { server: c.server, settings, onSection: c.props.onSection }),
};
for (const [name, build] of Object.entries(SINGLE_PAGES)) {
  PAGES.set(name, (c) => (c.settings[name] ? [build(c, c.settings[name])] : []));
}

for (const name of ["facade", "plaza", "floor", "walls", "ceiling"]) {
  PAGES.set(name, (c) => {
    /* Площадь есть не у каждого сервера (только Majestic): у прочих настроек нет — страницы тоже. */
    if (!c.settings[name]) return [];
    const surface = { server: c.server, id: name, settings: c.settings[name], onSurface: c.props.onSurface, onNotice: c.props.onNotice };
    return [h(SurfaceSection, surface)];
  });
}

for (const name of ["screens", "signs", "logos", "posters", "mazeSign", "outLogos", "outBanners"]) {
  PAGES.set(name, (c) => {
    if (!c.settings[name]) return [];
    const slot = {
      server: c.server,
      id: name,
      settings: c.settings[name],
      onSection: c.props.onSection,
      onNotice: c.props.onNotice,
      focus: c.props.focus ?? null,
      onFocus: c.server === "gta5rp" && ARENA_SIGN_SECTIONS.has(name) ? c.props.onFocus : null,
      selected: c.keyIn(name),
      over: overLabels(c.project),
      onSelect: c.chooserFor(name),
      aim: c.props.aim ?? 0,
      onHover: c.props.onHover ?? null,
      onFly: c.props.onFly ?? null,
    };
    return [h(SlotSection, slot)];
  });
}

function ArenaPanel(props) {
  useTr();
  const tool = props.tool === undefined ? "floor" : props.tool;
  const server = props.project.server;
  const element = props.element ?? null;
  const context = {
    props,
    tool,
    server,
    project: props.project,
    settings: props.project[server],
    stock: arenasProjectIsStock(props.project),
    decal: arenaServerInventory(server)?.decal,
    standardLabel: ARENA_STANDARD_LABELS[server],
    // выбранное полотно и его смена — общие для разделов с местами и замены моделей
    keyIn: (section) => (element?.section === section ? element.key || "" : ""),
    chooserFor: (section) => (props.onElement ? (key) => props.onElement(key ? { section, key } : null) : null),
  };
  const nodes = PAGES.get(tool)?.(context) ?? [];
  const page = h("div", { className: "fx-inspector recolor-inspector" }, ...nodes);
  return h(ArenaSceneContext.Provider, { value: props.items?.asset || null }, page);
}

function ArenaInspector(props) {
  useTr();
  const wantsMaze = props.tool === "text" && props.textPage === "mazeSign" && props.project?.[props.project.server]?.mazeSign;
  if (!wantsMaze) return h(ArenaPanel, props);
  const frame = {
    label: tr("Название арены"),
    note: tr("Текст"),
    backLabel: tr("К своим надписям"),
    onBack: () => props.onTextPage?.(""),
  };
  return h(PanelPage, frame, h(ArenaPanel, { ...props, tool: "mazeSign" }));
}

export default ArenaInspector;
