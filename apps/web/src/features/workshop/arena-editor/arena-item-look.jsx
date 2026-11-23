// Облик предмета зала: группа «Заменить», страница листа вещи и страница набора.
import { createElement as h, useEffect, useMemo, useRef, useState } from "react";
import SurfaceFit from "../../../components/ui/SurfaceFit.jsx";
import {
  HANGAR_EMBLEM_ACCEPT,
  convertedImageText,
  saveHangarEmblem,
  useHangarEmblemUrl,
} from "../hangar-editor/hangar-emblem.js";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import { useItemAction } from "../items-panel/ItemsPanel.jsx";
import Select from "../../../components/ui/Select.jsx";
import ListGroup, { ListRow, ListSub, ListThumb } from "../../../components/ui/ListGroup.jsx";
import { ARENA_SWATCHES, degreesText, scaleText } from "./arena-text.js";
import {
  PLACE_MODEL_IMAGE_SHAPES,
  PLACE_MODEL_SHAPE_LABELS,
} from "@modovik/climb-contract/recolor/place-models";
import { THING_WORDS, countedIn } from "../counted-words.js";
import { trFill } from "../../../locales/tr-fill.js";
import Slider from "../../../components/ui/Slider.jsx";
import { Cube, ImageSquare, UploadSimple } from "../../../components/ui/icons.jsx";
import { useFileDrop } from "../../../components/ui/file-drop.js";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import {
  ARENA_ITEM_LIMITS,
  arenaItemGroupOf,
  arenaItemPartGroups,
} from "@modovik/climb-contract/recolor/arena-item-looks";
import { tr, useTr } from "../../../locales/ui.js";
import {
  ITEM_ELEMENT_FIT,
  itemElementOf,
  withItemElement,
} from "@modovik/climb-contract/recolor/item-elements";
import {
  PLACE_MODEL_ACCEPT,
  placeModelFileKind,
  savePlaceModelSource,
} from "../models/model-assets.js";
import NavRow from "../../../components/ui/NavRow.jsx";

/* ---------- таблицы ---------- */

const FORMATS = { picture: "PNG, JPG, WebP", model: "GLB, glTF, OBJ" };
const COLOUR_DELAY_MS = 180;
const SOURCE_KINDS = ["model", "image"];
const SWAPPABLE = new Set(["picture", "model"]);
const SOURCE_ONLY_FIELDS = new Set(["converted", "notice", "animation"]);
const PICTURE_FIELDS = ["asset", "width", "height"];
const ITEM_DEFAULTS = { help: "", links: [], part: null, elements: null, screen: false };
const SHAPE_OPTIONS = [];
for (const shape of PLACE_MODEL_IMAGE_SHAPES) {
  SHAPE_OPTIONS.push(Object.freeze([shape, PLACE_MODEL_SHAPE_LABELS[shape]]));
}
Object.freeze(SHAPE_OPTIONS);

// Ползунки «Положения»: поле облика, подпись, существительное, шаг, вид значения.
const PLACE_SLIDERS = [
  ["scale", () => tr("Размер"), () => tr("размер"), 0.05, scaleText],
  ["turn", () => tr("Поворот"), () => tr("поворот"), 5, degreesText],
];

// Пояснение про замену: сперва «предмет или фрагмент», затем «есть ли лист под картинку».
const REPLACE_NOTES = {
  item: {
    lit: () =>
      tr("«Картинка вместо предмета» ставит на его место стенд с картинкой: плашка, объём, куб, шар или цилиндр. Модель вписывается в место прежней: её наклон и высота — те же."),
    plain: () =>
      tr("Картинка встанет на предмет формой: плашка, объём, куб, шар или цилиндр. Модель вписывается в место прежней: её наклон и высота — те же."),
  },
  piece: {
    lit: () =>
      tr("Это фрагмент игры: своя картинка ложится на его листы, физика и разлёт остаются как в игре. Стенда с картинкой и своей модели у фрагмента нет."),
    plain: () => tr("Это фрагмент игры: у него меняется только цвет."),
  },
};

/* ---------- функции без состояния ---------- */

function keepKey(key) {
  return key;
}

function failureText(error) {
  return String(error?.message || error);
}

function reportFailure(onNotice, error) {
  onNotice?.(failureText(error), "error");
}

function noteConverted(onNotice, converted) {
  return converted ? onNotice?.(convertedImageText(converted), "info") : undefined;
}

function backToGame() {
  return tr("как в игре");
}

// Работа, чей сбой уходит в уведомление, а не наружу; settle — что сделать в любом случае.
function guarded(onNotice, work, settle) {
  return async () => {
    try {
      await work();
    } catch (error) {
      reportFailure(onNotice, error);
    } finally {
      if (settle) settle();
    }
  };
}

// Занято на время работы: [когда началась, когда закончилась].
function runBusy(setBusy, [on, off], work, onNotice) {
  setBusy(on);
  return guarded(onNotice, work, () => setBusy(off))();
}

function offer(on, label, run, danger = false) {
  if (!on) return null;
  return danger ? { label, danger, run } : { label, run };
}

function dropOffer(on, label, onFile) {
  return on ? { label, onFile } : null;
}

function labeller(who, count) {
  const suffix = count > 1 ? ` (${count})` : "";
  return (text) => `${who}: ${text}${suffix}`;
}

function whoIs(name, part) {
  if (!part) return name;
  return `${name} · ${part.label}`;
}

// Свойства группы «Заменить»: заголовок и пояснения.
function replaceGroupProps(notes) {
  const props = { title: tr("Заменить") };
  props.help = notes;
  return props;
}

function manyNote(count) {
  if (count < 2) return "";
  return trFill("Применится к {0} шт.: все такие в выбранном охвате.", count);
}

function replaceNote(ctx) {
  const lit = ctx.canReplace ? ctx.fills : ctx.main;
  return REPLACE_NOTES[ctx.canReplace ? "item" : "piece"][lit ? "lit" : "plain"]();
}

function composeNotes(rules, ctx, tail = []) {
  const lines = [];
  for (const [applies, say] of rules) {
    if (applies(ctx)) lines.push(say(ctx));
  }
  return lines.concat(tail).filter(Boolean);
}

const ALWAYS = () => true;
const copyHintNote = (ctx) => tr(ctx.adapter.copyHint);

// Правила пояснений: [когда, текст]. Пустые строки отсеиваются при сборке.
const ITEM_NOTE_RULES = [
  [ALWAYS, (ctx) => manyNote(ctx.count)],
  [ALWAYS, copyHintNote],
  [
    (ctx) => ctx.main,
    () => tr("Своя картинка ложится на предмет, как текстура: на его главный лист по развёртке. Другие листы — в «Из чего» или вторым щелчком по предмету в кадре."),
  ],
  [
    (ctx) => ctx.screen,
    () => tr("Своя картинка, текст и студия — у экрана, выше. Корпус и другие листы — в «Из чего»."),
  ],
  [ALWAYS, replaceNote],
  [
    (ctx) => ctx.paintable,
    () => tr("Листы модели перекрашиваются в этот цвет, рисунок на ней остаётся. В кадре предмет показан одноцветным. Подробнее покрасить можно «В студию»."),
  ],
  [
    (ctx) => !ctx.paintable,
    () => tr("Листы этой модели общие с другими предметами игры: предмет станет одноцветным, его рисунок пропадёт. Подробнее покрасить можно «В студию»."),
  ],
  [(ctx) => ctx.help, (ctx) => ctx.help],
];

const SHEET_NOTE_RULES = [
  [ALWAYS, (ctx) => manyNote(ctx.count)],
  [ALWAYS, () => tr("Картинка ложится на этот лист предмета по его развёртке, как текстура; предмет остаётся на месте.")],
  [ALWAYS, () => tr("Свой цвет ложится на этот лист тоном: рисунок на нём остаётся. Картинка и цвет на одном листе сменяют друг друга.")],
  [ALWAYS, copyHintNote],
];

const MULTI_NOTE_RULES = [
  [ALWAYS, () => tr("Своя картинка ложится каждой вещи на её «Корпус», как текстура; «Цвет» красит каждую вещь целиком. Остальные листы — на странице вещи, в «Из чего».")],
  [(ctx) => ctx.skipped > 0, (ctx) => trFill("Картинку не возьмут {0} шт.: их моделей нет в описи Astral — им остаётся «Цвет».", ctx.skipped)],
  [ALWAYS, copyHintNote],
];

// Первое сработавшее правило «условие — текст».
function firstRule(rules) {
  for (const [hit, say] of rules) {
    if (hit) return say();
  }
  return undefined;
}

function refusalText(wanted) {
  switch (wanted) {
    case "model":
      return tr("Нужна модель: GLB, glTF или OBJ.");
    case "image":
      return tr("Нужна картинка: PNG, JPEG, WebP или GIF.");
    default:
      return tr("Нужна картинка (PNG, JPEG, WebP) или модель (GLB, glTF, OBJ).");
  }
}

function liveKeys(keys, removed) {
  const hidden = new Set(removed ?? []);
  const kept = [];
  for (const key of keys) {
    if (!hidden.has(key)) kept.push(key);
  }
  return kept;
}

function unanimous(values) {
  const first = values[0];
  if (!first) return null;
  return values.every((value) => value === first) ? first : null;
}

function pickFields(source, fields) {
  const picked = {};
  for (const field of fields) picked[field] = source[field];
  return picked;
}

function pictureOf(saved) {
  const found = pickFields(saved, PICTURE_FIELDS);
  if (saved.name) found.name = saved.name;
  return found;
}

function studioFill(saved) {
  return { picture: pickFields(saved, PICTURE_FIELDS), fit: "stretch" };
}

function modelFields(saved) {
  const fields = {};
  for (const [field, value] of Object.entries(saved)) {
    if (!SOURCE_ONLY_FIELDS.has(field)) fields[field] = value;
  }
  return fields;
}

function shapeFor(kind, group, fields) {
  if (kind === "model") return "mesh";
  if (group?.kind === "picture") return group.model.shape;
  const own = fields.shape;
  if (own && own !== "mesh") return own;
  return "plate";
}

// Что станет с предметом после загрузки файла: [облик, подпись].
function sourceLook(kind, group, saved, parts) {
  const fields = modelFields(saved);
  const model = { ...fields, shape: shapeFor(kind, group, fields) };
  if (kind === "model") return [{ kind: "model", model, ...parts }, tr("своя модель")];
  return [{ kind: "picture", model, ...parts }, tr("своя картинка")];
}

function announceSource(onNotice, saved) {
  const lines = [saved.notice, saved.animation && tr("Предмет встанет первым кадром гифки: живая картинка — у «Моделей» и полотен.")];
  for (const line of lines) {
    if (line) onNotice?.(line, "info");
  }
}

function patchedLook(group, parts, values) {
  const look = { kind: group.kind };
  if (group.colour) look.colour = group.colour;
  return Object.assign(look, { model: group.model }, parts, values);
}

function studioPictureLook(saved, picture, parts) {
  const model = { asset: saved.asset, shape: picture ? picture.model.shape : "plate" };
  model.width = saved.width;
  model.height = saved.height;
  return { kind: "picture", model, ...parts };
}

function stampPart(look, part) {
  return part ? { ...look, part } : look;
}

function hasLook(looks, key, part, group) {
  if (group) return true;
  if (part) return false;
  return arenaItemPartGroups(looks, key).length > 0;
}

function dropWantedKind(screen, canReplace) {
  if (screen) return "model";
  return canReplace ? null : "image";
}

// Главный лист вещи — самый крупный не экранный.
function mainSheetOf(elements, part, screen) {
  if (part || screen || !elements?.length) return null;
  for (const entry of elements) {
    if (!entry.screen) return entry;
  }
  return null;
}

// У объёмной вещи картинка ложится сразу на все её листы.
function wrapTexturesOf(elements, main) {
  if (!main?.wrap) return null;
  const textures = [];
  for (const entry of elements) {
    if (!entry.screen) textures.push(entry.texture);
  }
  return textures;
}

function fillCaption(elements, main) {
  if (elements.length < 2) return FORMATS.picture;
  return trFill("На «{0}» · {1}", main.label, FORMATS.picture);
}

function ratioOf(picture) {
  if (!picture) return 16 / 9;
  const { width, height } = picture;
  return width && height ? width / height : 16 / 9;
}

function currentFillOf(element, group) {
  if (!element) return null;
  return itemElementOf(group, element.texture);
}

// Облик с заливкой листа (или всех листов обёртки) картинкой либо цветом.
function layeredLook(group, element, cover, value) {
  const everywhere = Boolean(cover?.length);
  let textures = [element.texture];
  if (everywhere && !value.colour) textures = cover;
  const payload = everywhere && value.picture ? { ...value, around: true } : value;
  let look = group;
  for (const texture of textures) look = withItemElement(look, { texture, ...payload });
  return look;
}

// «Корпус» вещи, если её модель есть в описи: массив из нуля или одной картинки.
function bodyPictureOf(adapter, looks, key) {
  if (!adapter.paintable({ key })) return [];
  const main = adapter.mainElement({ key });
  if (!main) return [];
  const owner = arenaItemGroupOf(looks, key);
  const found = itemElementOf(owner, main.texture);
  return [found?.picture || null];
}

// Перепись набора: живые вещи, кто возьмёт картинку, что у всех общее, тронут ли облик.
function surveyThings(props) {
  const { adapter, looks } = props;
  const lookKeyOf = props.lookKeyOf === undefined ? keepKey : props.lookKeyOf;
  const alive = liveKeys(props.keys, props.removed).map(lookKeyOf);
  const touched = new Set();
  for (const entry of looks || []) {
    for (const key of entry.keys) touched.add(key);
  }
  const takers = [];
  const tints = [];
  for (const key of alive) {
    takers.push(...bodyPictureOf(adapter, looks, key));
    const group = arenaItemGroupOf(looks, key);
    tints.push(group?.kind === "colour" ? group.colour : null);
  }
  const assets = takers.map((entry) => entry?.asset);
  return {
    alive,
    takers,
    label: countedIn(alive.length, THING_WORDS),
    picture: unanimous(assets) && takers[0],
    colour: unanimous(tints),
    changed: alive.some((key) => touched.has(key)),
  };
}

// Снять «Корпус»-картинку у каждой вещи набора, остальное не трогая.
function dropBodyPicture(adapter) {
  return function withoutBody(_model, modelKeys, current) {
    const [first] = modelKeys;
    const main = adapter.mainElement({ key: first });
    const plain = !main || current?.kind !== "elements";
    return plain ? undefined : withItemElement(current, { texture: main.texture });
  };
}

function fileReceiver(receive) {
  return function onPick({ target }) {
    const picked = Array.from(target.files ?? [])[0];
    target.value = "";
    return picked ? receive(picked) : undefined;
  };
}

/* ---------- мелкая разметка ---------- */

function lookFrame(ref, extra, ...children) {
  return h("div", { ref, className: "recolor-subsection arena-item-look", ...extra }, ...children);
}

function hiddenInput(ref, accept, onChange, label) {
  return h("input", { ref, type: "file", accept, hidden: true, onChange, "aria-label": label });
}

function fileRow(kind, input, onClear, face) {
  return h(ListRow, {
    ...face,
    onOpen: () => input.current?.click(),
    onClear,
    "data-item-look": kind,
  });
}

function colourRow(kind, label, value, onChange, onClear, key) {
  return h(ColourRow, {
    key,
    label,
    value,
    colours: ARENA_SWATCHES,
    onChange,
    onClear,
    "data-item-look": kind,
  });
}

function studioButtonProps(onNotice, held, route) {
  return {
    getSurface: route.getSurface,
    image: held ? { asset: held.asset } : null,
    onImage: route.onImage,
    onNotice,
    save: saveHangarEmblem,
    slug: route.slug,
    label: tr("Нарисовать в студии"),
    caption: tr("Кисть, слои, текст"),
  };
}

// Всё, что заливке листа нужно от страницы: облик, охват, вывод и подписи.
function hostFor(props, group, keys, say) {
  return { group, keys, say, onLook: props.onLook, onNotice: props.onNotice };
}

// Студия для листа вещи: рисунок ляжет заливкой этого листа.
function sheetStudioProps(props, sheet, fill) {
  const { adapter, item } = props;
  return studioButtonProps(props.onNotice, fill.current?.picture, {
    getSurface: function sheetSurface() {
      return adapter.elementStudio(item, props.name, sheet);
    },
    onImage: fill.fromStudio,
    slug: `item-${item.key}-${sheet.texture}`,
  });
}

function LookThumb(props) {
  return h(ListThumb, { src: useHangarEmblemUrl(props.asset) });
}

// Правый край строки: миниатюра, если картинка есть, иначе значок загрузки.
function trailingMark(present, asset) {
  return present ? h(LookThumb, { asset }) : h(UploadSimple, { "aria-hidden": "true" });
}

function ElementPicture(props) {
  const { fill, title } = props;
  useTr();
  const picture = fill.current?.picture ?? null;
  const url = useHangarEmblemUrl(picture ? picture.asset || "" : "");
  const tile = {
    label: `${tr("Своя картинка")} · ${title}`,
    inputLabel: `${title}: ${tr("файл своей картинки")}`,
    src: picture ? url : "",
    aspect: ratioOf(picture),
    fit: "cover",
    caption: picture ? picture.name || tr("из файла") : "",
    empty: tr("Своя картинка"),
    emptyCaption: props.caption ?? FORMATS.picture,
    accept: HANGAR_EMBLEM_ACCEPT,
    busy: fill.busy,
    dropSelf: true,
    onFile: fill.take,
    onClear: picture ? fill.clear : null,
    clearLabel: tr("Вернуть как в игре"),
  };
  const fitter = h(SurfaceFit, {
    fit: fill.current?.fit,
    onFit: fill.fit,
    label: `${title}: ${tr("как вписать картинку")}`,
    "data-item-look-fit": "",
  });
  return h(
    "div",
    { className: "arena-item-picture", "data-item-look": "fill" },
    h(SurfacePicture, tile),
    picture ? fitter : null,
  );
}

/* ---------- хуки ---------- */

// Отложенная работа над цветом: новый выбор отменяет прежний, выход гасит таймер.
function useColourDelay() {
  const timer = useRef(0);
  useEffect(() => {
    return () => {
      clearTimeout(timer.current);
    };
  }, []);
  return function defer(job) {
    const previous = timer.current;
    timer.current = setTimeout(job, COLOUR_DELAY_MS);
    clearTimeout(previous);
  };
}

function useScopeKeys(adapter, item, scope, removed) {
  return useMemo(() => liveKeys(adapter.keys(item, scope), removed), [adapter, item, scope, removed]);
}

// Своя картинка или цвет на листе вещи — заливкой.
function useElementFill(element, cover, host) {
  const { group, keys } = host;
  const [busy, setBusy] = useState(() => false);
  const schedule = useColourDelay();
  const current = currentFillOf(element, group);

  function put(value, text) {
    host.onLook(keys, layeredLook(group, element, cover, value), host.say(text));
  }

  function take(file) {
    const job = async () => {
      const outcome = await saveHangarEmblem(file);
      const fit = current ? current.fit || ITEM_ELEMENT_FIT : ITEM_ELEMENT_FIT;
      put({ picture: pictureOf(outcome), fit }, tr("своя картинка"));
      noteConverted(host.onNotice, outcome.converted);
    };
    return runBusy(setBusy, [true, false], job, host.onNotice);
  }

  function clear() {
    put({}, backToGame());
  }

  function setFit(fit) {
    const held = current?.picture;
    if (!held) return undefined;
    return put({ picture: held, fit }, tr("подгонка"));
  }

  function setColour(colour) {
    schedule(function applyColour() {
      put({ colour }, tr("цвет"));
    });
  }

  function fromStudio(saved) {
    put(studioFill(saved), tr("рисунок из студии"));
  }

  return { busy, current, take, clear, fit: setFit, paint: setColour, fromStudio };
}

/* ---------- страница набора ---------- */

function MultiLook(props) {
  const { adapter, onLook, onNotice } = props;
  useTr();
  const refs = { root: useRef(null), input: useRef(null) };
  const [busy, setBusy] = useState(() => false);
  const schedule = useColourDelay();

  const survey = surveyThings(props);
  const { alive, takers } = survey;
  const labelOf = labeller(survey.label, 1);

  function commitAll(look, text) {
    onLook(alive, look, labelOf(text));
  }

  function resetAll() {
    commitAll(null, backToGame());
  }

  function unpicture() {
    commitAll(dropBodyPicture(adapter), backToGame());
  }

  function take(file) {
    const job = async () => {
      const outcome = await saveHangarEmblem(file);
      commitAll(adapter.pictureMany(pictureOf(outcome)).look, tr("своя картинка"));
      noteConverted(onNotice, outcome.converted);
    };
    return runBusy(setBusy, [true, false], job, onNotice);
  }

  function paint(value) {
    schedule(
      guarded(onNotice, async () => {
        const painted = await adapter.paintMany(alive, value);
        commitAll(painted.look, tr("цвет"));
        const firstFailure = painted.failed.values().next();
        return firstFailure.done ? undefined : onNotice?.(firstFailure.value, "error");
      }),
    );
  }

  useItemAction("look", offer(survey.changed && alive.length, tr("Вернуть как в игре"), resetAll));
  useFileDrop(
    refs.root,
    dropOffer(takers.length && !busy, trFill("Отпустите — встанет на {0}", survey.label), take),
  );
  if (alive.length === 0) return null;

  const [lead] = alive;
  const reason = adapter.reason?.({ key: lead });
  if (reason) return h("p", { className: "fx-hint" }, tr(reason));

  const { picture } = survey;
  const pictureRow = fileRow("fill", refs.input, picture ? unpicture : null, {
    icon: h(ImageSquare),
    title: tr("Своя картинка"),
    caption: firstRule([
      [busy, () => tr("Читаем…")],
      [picture, () => picture.name || tr("из файла")],
      [true, () => `${tr("На «Корпус» каждой")} · ${FORMATS.picture}`],
    ]),
    trailing: trailingMark(picture, picture?.asset),
    disabled: Boolean(busy),
  });
  const rows = [takers.length > 0 ? pictureRow : null, colourRow("colour", tr("Цвет"), survey.colour, paint, resetAll)];
  const notes = composeNotes(MULTI_NOTE_RULES, { adapter, skipped: alive.length - takers.length });
  return lookFrame(
    refs.root,
    { "data-arena-item-look": "many" },
    hiddenInput(refs.input, HANGAR_EMBLEM_ACCEPT, fileReceiver(take), `${survey.label}: ${tr("файл своей картинки")}`),
    h(ListGroup, replaceGroupProps(notes), ...rows),
  );
}

/* ---------- страница листа вещи ---------- */

function ElementLook(props) {
  const { adapter, item, element } = props;
  const group = arenaItemGroupOf(props.looks, item.key);
  const who = `${props.name} · ${element.label}`;
  useTr();
  const root = useRef();
  const keys = useScopeKeys(adapter, item, props.scope, props.removed);
  const fill = useElementFill(element, null, hostFor(props, group, keys, labeller(who, keys.length)));

  useItemAction("element", offer(fill.current && keys.length, tr("Вернуть как в игре"), fill.clear));
  useFileDrop(root, dropOffer(keys.length && !fill.busy, trFill("Отпустите — встанет на {0}", who), fill.take));
  if (keys.length === 0) return null;

  const rows = [
    colourRow("element-colour", `${who}: ${tr("цвет")}`, fill.current?.colour || null, fill.paint, fill.clear),
    h(StudioPictureButton, sheetStudioProps(props, element, fill)),
  ];
  const notes = composeNotes(SHEET_NOTE_RULES, { adapter, count: keys.length });
  return lookFrame(
    root,
    { "data-arena-item-look": item.key, "data-arena-element-look": element.texture },
    h(ElementPicture, { fill, title: who }),
    h(ListGroup, replaceGroupProps(notes), ...rows),
  );
}

/* ---------- страница предмета ---------- */

// Состояние и действия страницы предмета; без вещей в охвате отдаёт null.
function useItemLook(props) {
  const { adapter, item, part } = props;
  const { name, screen, elements } = props;
  const { looks, onLook, onNotice } = props;
  const group = arenaItemGroupOf(looks, item.key, part);
  const parts = {};
  for (const [field, fallback] of [["scale", 1], ["turn", 0]]) parts[field] = group?.[field] ?? fallback;

  useTr();
  const refs = { root: useRef(null), model: useRef(null), picture: useRef(null) };
  const [busy, setBusy] = useState(() => "");
  const keys = useScopeKeys(adapter, item, props.scope, props.removed);
  const schedule = useColourDelay();

  const canReplace = keys.length === 0 ? false : adapter.canReplace(item);
  const who = whoIs(name, part);
  const labelOf = labeller(who, keys.length);
  const commit = (look, text, ...rest) => onLook(keys, look, labelOf(text), ...rest);
  const apply = (look, text) => commit(stampPart(look, part), text);

  function reset() {
    commit(null, backToGame(), part);
  }

  function patch(values, text) {
    if (group) apply(patchedLook(group, parts, values), text);
  }

  // wanted: "model" | "image" | null (подойдёт любой файл)
  async function take(file, wanted = null) {
    const kind = placeModelFileKind(file);
    if (!(wanted ? [wanted] : SOURCE_KINDS).includes(kind)) {
      onNotice?.(refusalText(wanted), "error");
      return;
    }
    const job = async () => {
      const saved = await savePlaceModelSource(file);
      const [look, text] = sourceLook(kind, group, saved, parts);
      apply(look, text);
      announceSource(onNotice, saved);
    };
    await runBusy(setBusy, [kind, ""], job, onNotice);
  }

  function paint(colour) {
    schedule(
      guarded(onNotice, async () => {
        const painted = await adapter.paint(item, colour, part);
        apply(Object.assign({}, painted, parts), tr("цвет"));
      }),
    );
  }

  const main = mainSheetOf(elements, part, screen);
  const fills = Boolean(main || screen);
  const fill = useElementFill(main, wrapTexturesOf(elements, main), hostFor(props, group, keys, labelOf));

  const swapped = !part && SWAPPABLE.has(group?.kind);
  const partGone = part ? group?.kind === "removed" : false;
  const swapLabel = group?.kind === "picture" ? tr("Убрать картинку") : tr("Убрать свою модель");
  useItemAction("swap", offer(swapped && keys.length, swapLabel, reset, true));
  useItemAction(
    "look",
    offer(hasLook(looks, item.key, part, group) && !swapped && keys.length, tr("Вернуть как в игре"), reset),
  );
  useItemAction(
    "part-remove",
    offer(
      part && !partGone && keys.length,
      tr("Убрать эту часть"),
      () => commit({ kind: "removed", part }, tr("убрана")),
      true,
    ),
  );
  const onDrop = (file) => {
    if (main && placeModelFileKind(file) === "image") return fill.take(file);
    return take(file, dropWantedKind(screen, canReplace));
  };
  const dropReady = !busy && !fill.busy;
  useFileDrop(
    refs.root,
    dropOffer(dropReady && (canReplace || main), trFill("Отпустите — встанет на {0}", name), onDrop),
  );
  if (keys.length < 1) return null;

  const ofKind = (kind) => (group?.kind === kind ? group : null);
  const picture = ofKind("picture");
  const tint = ofKind("colour");
  const fromStudio = (saved) => apply(studioPictureLook(saved, picture, parts), tr("рисунок из студии"));
  const links = props.links;
  const notes = composeNotes(
    ITEM_NOTE_RULES,
    { adapter, count: keys.length, main, screen, canReplace, fills, paintable: adapter.paintable(item), help: props.help },
    links.map((link) => link.hint),
  );
  const studioProps = main
    ? sheetStudioProps(props, main, fill)
    : studioButtonProps(onNotice, picture && picture.model, {
        getSurface: function itemSurface() {
          return adapter.studio(item, name, part);
        },
        onImage: fromStudio,
        slug: `item-${item.key}`,
      });

  return {
    title: `${tr("Предмет")}: ${name}`,
    item,
    refs,
    layout: { part, screen, elements, links, canReplace, sheet: main, lit: fills, gone: partGone },
    busy,
    fill,
    look: { group, picture, model: ofKind("model"), colour: tint ? tint.colour : null },
    notes,
    act: { take, reset, patch, paint },
    studioProps,
  };
}

function PartRemovedRow() {
  return h(
    "div",
    { className: "items-status-row", "data-items-status": "part-removed" },
    h("span", { className: "items-status-dot", "aria-hidden": "true" }),
    h("span", { className: "items-status-copy" }, h("b", null, tr("Часть убрана"))),
  );
}

function pictureStandRow(L) {
  const { lit } = L.layout;
  const { picture } = L.look;
  return fileRow("picture", L.refs.picture, picture ? L.act.reset : null, {
    icon: lit ? h(Cube) : h(ImageSquare),
    title: lit ? tr("Картинка вместо предмета") : tr("Своя картинка"),
    caption: firstRule([
      [L.busy === "image", () => tr("Читаем…")],
      [picture, () => picture.model.name || tr("из файла")],
      [lit, () => tr("Стенд с картинкой на месте предмета")],
      [true, () => FORMATS.picture],
    ]),
    trailing: trailingMark(picture, picture?.model.asset),
    disabled: Boolean(L.busy),
  });
}

function ownModelRow(L) {
  const { model } = L.look;
  return fileRow("model", L.refs.model, model ? L.act.reset : null, {
    icon: h(Cube),
    title: tr("Своя модель"),
    caption: firstRule([
      [L.busy === "model", () => tr("Читаем…")],
      [model, () => model.model.name || tr("из файла")],
      [true, () => FORMATS.model],
    ]),
    trailing: trailingMark(false),
    disabled: Boolean(L.busy),
  });
}

function shapePicker(L) {
  const { picture } = L.look;
  return h(
    ListSub,
    null,
    h(Select, {
      label: tr("Форма"),
      ariaLabel: `${L.title}: ${tr("форма")}`,
      value: picture.model.shape,
      options: translatedShapes(),
      onChange: (shape) => L.act.patch({ model: Object.assign({}, picture.model, { shape }) }, tr("форма")),
    }),
  );
}

function translatedShapes() {
  const options = [];
  for (const [value, text] of SHAPE_OPTIONS) options.push([value, tr(text)]);
  return options;
}

function linkRow(link) {
  return h(NavRow, {
    key: link.id,
    icon: link.icon || null,
    title: link.title,
    caption: link.caption || null,
    "aria-label": link.title,
    onOpen: link.onOpen,
  });
}

// Три строки замены: картинка, (форма), модель.
function replaceTrio(L) {
  const shaped = L.look.picture && !L.layout.part;
  return (
    <>
      {pictureStandRow(L)}
      {shaped ? shapePicker(L) : null}
      {ownModelRow(L)}
    </>
  );
}

function itemColourRow(L) {
  const key = `${L.item.key}:${L.layout.part?.label || ""}`;
  return colourRow("colour", tr("Цвет предмета"), L.look.colour, L.act.paint, L.act.reset, key);
}

// Строки группы «Заменить»: условие показа и сборка.
const ITEM_GROUP_ROWS = [
  [(L) => L.layout.canReplace, replaceTrio],
  [ALWAYS, itemColourRow],
  [(L) => !L.layout.screen, (L) => h(StudioPictureButton, L.studioProps)],
];

function replaceGroup(L) {
  const rows = ITEM_GROUP_ROWS.map(([shown, build]) => (shown(L) ? build(L) : null));
  return h(ListGroup, replaceGroupProps(L.notes), ...rows, L.layout.links.map(linkRow));
}

function placeGroup(L) {
  const { picture, model, group } = L.look;
  if (L.layout.gone || !((picture && !L.layout.part) || model)) return null;
  const sliders = PLACE_SLIDERS.map(([field, title, noun, step, format]) => {
    const [min, max] = ARENA_ITEM_LIMITS[field];
    return h(Slider, {
      label: title(),
      ariaLabel: `${L.title}: ${noun()}`,
      value: group[field],
      min,
      max,
      step,
      format,
      onChange: (value) => L.act.patch({ [field]: value }, noun()),
    });
  });
  return h(ListGroup, { title: tr("Положение"), plain: true, "data-items-group": "place" }, ...sliders);
}

// Скрытые поля выбора файла: [ссылка, допустимые типы, ждём, подпись].
function itemInputs(L) {
  const picturePrompt = L.layout.lit ? tr("файл картинки вместо предмета") : tr("файл своей картинки");
  return [
    [L.refs.model, PLACE_MODEL_ACCEPT, "model", tr("файл своей модели")],
    [L.refs.picture, HANGAR_EMBLEM_ACCEPT, "image", picturePrompt],
  ].map(([ref, accept, wanted, prompt]) =>
    hiddenInput(ref, accept, fileReceiver(function pickTaker(file) { return L.act.take(file, wanted); }), `${L.title}: ${prompt}`),
  );
}

function withDefaults(props, defaults) {
  const full = { ...props };
  for (const [field, value] of Object.entries(defaults)) {
    if (full[field] === undefined) full[field] = value;
  }
  return full;
}

function ItemLook(props) {
  const L = useItemLook(withDefaults(props, ITEM_DEFAULTS));
  if (!L) return null;

  const { sheet, gone } = L.layout;
  const body = gone
    ? [h(PartRemovedRow)]
    : [
        sheet ? h(ElementPicture, { fill: L.fill, title: L.title, caption: fillCaption(L.layout.elements, sheet) }) : null,
        replaceGroup(L),
      ];
  return lookFrame(
    L.refs.root,
    { "data-arena-item-look": L.item.key },
    ...itemInputs(L),
    ...body,
    placeGroup(L),
  );
}

export { ElementLook, MultiLook };
export default ItemLook;
