import { createElement as h, useMemo, useRef, useState } from "react";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import Checkbox from "../../../components/ui/Checkbox.jsx";
import {
  HANGAR_EMBLEM_ACCEPT,
  saveHangarEmblem,
  useHangarEmblemUrl,
} from "../hangar-editor/hangar-emblem.js";
import Button from "../../../components/ui/Button.jsx";
import {
  massLook,
  massPatch,
  massRoomCount,
  massSnapshot,
  massTargets,
} from "./arena-mass-replace.js";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import { ImageSquare, UploadSimple } from "../../../components/ui/icons.jsx";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup, { ListRow, ListThumb } from "../../../components/ui/ListGroup.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";

const SCREENS_SECTION = "screens";
const FALLBACK_ASPECT = "16 / 9";
// Для CSS «растянуть» называется fill, остальные значения совпадают.
const CSS_FIT = { stretch: "fill" };
const ROOM_DIGITS = /\d+/;

const headline = () => tr("Заменить картинку у всех");

// Подстановка единственного {0} в уже переведённый шаблон.
const fill = (template, value) => template.replace("{0}", value);

const fitOptions = () =>
  [
    ["cover", tr("Заполнить")],
    ["contain", tr("Вписать")],
    ["stretch", tr("Растянуть")],
  ].map(([value, label]) => ({ value, label }));

const numberedRoom = (text) => {
  const found = text.match(ROOM_DIGITS);
  return found ? fill(tr("комната {0}"), Number(found[0])) : text;
};

const roomName = (room) => (room == null ? tr("Зал") : numberedRoom(String(room)));

// Новое множество с переключённым значением; прежнее не трогаем.
const flipMember = (set, value) =>
  set.has(value)
    ? new Set([...set].filter((item) => item !== value))
    : new Set(set).add(value);

const flipper = (cell, value) => () => cell.set((previous) => flipMember(previous, value));

const fitFor = ({ same, fit, fits }, groupId) => {
  if (same.value) return fit.value;
  return fits.value[groupId] || "cover";
};

const captionOf = ({ busy, picture }) => {
  if (busy.value) return tr("Читаем…");
  const saved = picture.value;
  if (!saved) return "PNG, JPG, WebP";
  return `${saved.name || tr("из файла")} · ${saved.width} × ${saved.height}`;
};

const undoAction = (onClick) => ({ id: "undo", label: tr("Отменить"), onClick });

// Какой род владеет каждым местом: ключ места → id рода.
const ownerIndex = (groups) => {
  const owner = new Map();
  for (const { id, elements } of groups) {
    for (const { key } of elements) owner.set(key, id);
  }
  return owner;
};

const targetsOf = ({ groups, chosen, excluded }) => massTargets(groups, chosen, excluded);

const FitPreview = ({ url, fit, ratio }) => {
  const style = { aspectRatio: ratio ? `${ratio.w} / ${ratio.h}` : FALLBACK_ASPECT };
  const image = url
    ? h("img", { src: url, alt: "", style: { objectFit: CSS_FIT[fit] || fit } })
    : null;
  return h("div", { className: "arena-mass-preview", style }, image);
};

// Строка-флажок: подпись слева, необязательный хвост справа.
const optionRow = ({ id, checked, cell, label, note, tail }) => {
  const copy = h(
    "span",
    { className: "arena-mass-copy" },
    h("b", null, label),
    h("small", null, ...note),
  );
  return h(
    Checkbox,
    {
      key: id,
      className: "arena-mass-type",
      checked,
      onChange: flipper(cell, id),
      ariaLabel: label,
    },
    ...(tail ? [copy, tail] : [copy]),
  );
};

const targetRow = (group, v) =>
  optionRow({
    id: group.id,
    checked: v.chosen.value.has(group.id),
    cell: v.chosen,
    label: tr(group.label),
    note: [
      fill(tr("{0} шт."), group.elements.length),
      " · ",
      fill(tr("Комнаты: {0}"), massRoomCount(group)),
    ],
    tail: h("span", { className: "arena-mass-ratio" }, group.ratio?.label || "—"),
  });

const placeRow = (element, v) =>
  optionRow({
    id: element.key,
    checked: !v.excluded.value.has(element.key),
    cell: v.excluded,
    label: element.label,
    note: [roomName(element.room)],
  });

const fitChooser = (v, label, value, onChange) =>
  h(SegmentedControl, { label, size: "sm", options: v.fitChoices, value, onChange });

const fitCard = (group, v) => {
  const name = tr(group.label);
  const current = v.fitOf(group.id);
  const setOwn = (value) =>
    v.fits.set((previous) => Object.assign({}, previous, { [group.id]: value }));
  return h(
    "div",
    { key: group.id, className: "arena-mass-fit" },
    h(FitPreview, { url: v.url, fit: current, ratio: group.ratio }),
    h("small", null, name),
    v.same.value ? null : fitChooser(v, `${name}: ${tr("Как ляжет")}`, current, setOwn),
  );
};

const whereSection = (v) => {
  const rows = v.groups.map((group) => targetRow(group, v));
  const body = rows.length ? rows : h("p", { className: "fx-hint" }, tr("В зале нет экранов."));
  return h(
    ListGroup,
    { plain: true, title: tr("Куда"), help: tr("Одна картинка на все отмеченные экраны сразу.") },
    body,
  );
};

const fileField = (v) =>
  h("input", {
    ref: v.input,
    type: "file",
    accept: HANGAR_EMBLEM_ACCEPT,
    hidden: true,
    onChange: v.pick,
    "aria-label": tr("Картинка"),
  });

const pictureSection = (v) => {
  const chosenPicture = v.picture.value;
  return h(
    ListGroup,
    { title: tr("Картинка") },
    h(ListRow, {
      icon: h(ImageSquare),
      title: tr("Своя картинка"),
      caption: captionOf(v),
      trailing: chosenPicture
        ? h(ListThumb, { src: v.url })
        : h(UploadSimple, { "aria-hidden": "true" }),
      disabled: v.busy.value,
      onOpen: () => v.input.current?.click(),
      "data-arena-mass-picture": chosenPicture ? "set" : "empty",
    }),
  );
};

const fitSection = (v) =>
  h(
    "div",
    { className: "recolor-subsection" },
    h("h3", null, tr("Как ляжет")),
    h("div", { className: "arena-mass-fits" }, v.chosenGroups.map((group) => fitCard(group, v))),
    h(SwitchLine, { label: tr("Одинаково для всех"), checked: v.same.value, onChange: v.same.set }),
    v.same.value ? fitChooser(v, tr("Как ляжет"), v.fit.value, v.fit.set) : null,
  );

const excludeSection = (v) =>
  h(
    "details",
    { className: "arena-mass-exclude" },
    h("summary", null, tr("Исключить места")),
    v.chosenGroups
      .map(({ elements }) => elements)
      .flat()
      .map((element) => placeRow(element, v)),
  );

const replaceSection = (v) => {
  if (!v.picture.value || v.targets.length === 0) return null;
  const caption = fill(tr("Заменить: {0}"), v.targets.length);
  return h(
    "div",
    { className: "recolor-actions" },
    h(Button, { variant: "primary", disabled: v.busy.value, onClick: v.apply }, caption),
  );
};

const statusSection = ({ applied }) =>
  applied.value
    ? h(
        "p",
        { className: "fx-hint", role: "status" },
        `${tr("Картинка поставлена")}: ${applied.value.count}`,
      )
    : null;

const undoSection = ({ applied, undo }) =>
  h(ActionRows, {
    label: headline(),
    actions: [applied.value ? undoAction(undo) : null],
  });

// Порядок блоков страницы сверху вниз.
const PAGE_SECTIONS = [
  whereSection,
  fileField,
  pictureSection,
  fitSection,
  excludeSection,
  replaceSection,
  statusSection,
  undoSection,
];

// Ячейка состояния: значение и установщик одним объектом (внутри один useState).
const useCell = (initial) => {
  const [value, set] = useState(initial);
  return { value, set };
};

const useSelection = (groups) => ({
  chosen: useCell(() => new Set(Array.from(groups, (group) => group.id))),
  excluded: useCell(() => new Set()),
});

const usePictureState = () => ({ picture: useCell(null), busy: useCell(false) });

const useFitState = () => ({ fit: useCell("cover"), same: useCell(true), fits: useCell({}) });

// Читает файл и возвращает либо сохранённую картинку с заметкой, либо только заметку об ошибке.
const readPicture = async (file) => {
  try {
    const { converted, ...saved } = await saveHangarEmblem(file);
    const notice = converted ? tr("Картинка переведена в PNG, чтобы встать на экран.") : null;
    return { saved, notice };
  } catch (error) {
    return { saved: null, notice: error?.message || tr("Картинка не открылась.") };
  }
};

const makePick = ({ picture, busy, onNotice }) => async (event) => {
  const field = event.target;
  const file = field.files?.[0];
  field.value = "";
  if (!file) return;
  busy.set(true);
  try {
    const { saved, notice } = await readPicture(file);
    if (saved) picture.set(saved);
    if (notice) onNotice?.(notice);
  } finally {
    busy.set(false);
  }
};

const replaceAll = ({ picture, targets, settings, groupOf, fitOf, onSection, applied }) => {
  const count = targets.length;
  // Снимок прежних правок берём до того, как раздел будет изменён.
  const previous = massSnapshot(settings);
  const lookFor = ({ key }) => massLook(picture.value, fitOf(groupOf.get(key)));
  const patch = massPatch(settings, targets, lookFor);
  onSection(SCREENS_SECTION, patch, `${headline()}: ${count}`);
  applied.set({ count, previous });
};

const makeApply = (ctx) => () => {
  if (ctx.picture.value && ctx.targets.length) replaceAll(ctx);
};

const makeUndo = ({ applied, onSection }) => () => {
  const done = applied.value;
  if (!done) return;
  onSection(SCREENS_SECTION, done.previous, [tr("Отменить"), headline()].join(": "));
  applied.set(null);
};

// Всё, что нужно блокам страницы; порядок вызовов хуков зафиксирован описанием.
const useMassView = ({ groups, settings, onSection, onNotice }) => {
  const { chosen, excluded } = useSelection(groups);
  const { picture, busy } = usePictureState();
  const { fit, same, fits } = useFitState();
  const applied = useCell(null);
  const input = useRef(null);
  const url = useHangarEmblemUrl(picture.value?.asset);
  const targets = useMemo(
    () => targetsOf({ groups, chosen: chosen.value, excluded: excluded.value }),
    [groups, chosen.value, excluded.value],
  );
  const groupOf = useMemo(() => ownerIndex(groups), [groups]);

  const cells = { chosen, excluded, picture, busy, fit, same, fits, applied };
  const fitOf = (groupId) => fitFor(cells, groupId);
  const isChosen = (group) => chosen.value.has(group.id);
  const ctx = {
    ...cells,
    groups,
    settings,
    onSection,
    onNotice,
    input,
    url,
    targets,
    groupOf,
    fitOf,
    fitChoices: fitOptions(),
    chosenGroups: groups.filter(isChosen),
  };
  return { ...ctx, pick: makePick(ctx), apply: makeApply(ctx), undo: makeUndo(ctx) };
};

const MassReplace = (props) => {
  useTr();
  const view = useMassView(props);
  return h(
    PanelPage,
    { label: headline(), backLabel: tr("Предметы"), onBack: props.onBack },
    h(
      "div",
      { className: "arena-mass", "data-arena-mass": true },
      ...PAGE_SECTIONS.map((build) => build(view)),
    ),
  );
};

export default MassReplace;
