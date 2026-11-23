import { trFill } from "../../../locales/tr-fill.js";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import {
  MSL_LIMITS,
  MSL_MOD_DISTANCE,
  MSL_MOD_WIDTH,
  MSL_PALETTE,
  findMslColour,
  mslColourLook,
  mslZonesIsMod,
} from "@modovik/climb-contract/recolor/msl-zones";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import Slider from "../../../components/ui/Slider.jsx";
import {
  MSL_SWATCHES,
  distanceHint,
  distanceOptions,
  distanceText,
  metresText,
  mslColourRow,
  percentText,
} from "./msl-zones-text.js";
import ListGroup, { ListSub, ListSwatch } from "../../../components/ui/ListGroup.jsx";
import EffectSegmentField from "../effect-segment-field.jsx";
import { Fragment, createElement as h } from "react";
import MslZonesPresets from "./MslZonesPresets.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";

// Ползунки раздела «shape»: поле проекта -> параметры.
const SHAPE_SLIDERS = [
  {
    key: "width",
    title: () => tr("Ширина линии"),
    step: 0.05,
    show: (value) => metresText(value),
    journal: "Ширина линий",
  },
  {
    key: "height",
    title: () => tr("Высота стенки"),
    step: 0.1,
    show: wallText,
    journal: "Высота стенки",
  },
];

function wallText(value) {
  if (value > 0) return metresText(value);
  return tr("нет");
}

const action = (id, label, onClick) => ({ id, label, onClick });

// Обработчик «одно поле проекта -> одна запись в журнале»; convert меняет значение слайдера.
const patcher =
  (onPatch, key, journal, convert = (value) => value) =>
  (next) =>
    onPatch({ [key]: convert(next) }, journal);

// То же для полей облика: подпись шага приходит от самого поля.
const stepPatcher = (onPatch, key) => (next, step) => onPatch({ [key]: next }, step);

const track = (limits, props) => h(Slider, { min: limits[0], max: limits[1], ...props });

const plainGroup = (label, help, ...kids) => h(ListGroup, { plain: true, label, help }, ...kids);

const DIRECTIONS = Object.freeze({
  along: "Вдоль линии",
  across: "Поперёк района",
  height: "Снизу вверх",
});

const lookField = (props) =>
  h(EffectSegmentField, { hints: { height: "" }, directionLabels: DIRECTIONS, ...props });

function colourOf(id) {
  const found = findMslColour(id);
  return found || MSL_PALETTE[0];
}

const colourCount = (colours) => Object.keys(colours).length;

const without = (colours, id) =>
  Object.fromEntries(Object.entries(colours).filter(([key]) => key !== id));

const leadWith = (colour) => [colour].concat(MSL_SWATCHES.filter((hex) => hex !== colour));

function translated(option) {
  return Object.assign({}, option, { label: tr(option.label) });
}

const modeStep = (own) => {
  if (own) return tr("Один цвет на все линии");
  return tr("Свой цвет у каждого цвета мода");
};

const modeOptions = () =>
  [
    ["each", tr("Свой у каждого цвета")],
    ["all", tr("Один на все линии")],
  ].map(([value, label]) => ({ value, label }));

const modeHandler = (project, onPatch) => (value) => {
  const next = { ownColour: value === "all" };
  if (next.ownColour === project.ownColour) return;
  onPatch(next, modeStep(next.ownColour));
};

// Один цвет мода внутри своей карточки: новый облик ложится в project.colours.
const colourPatcher = (project, id, onPatch) => (look, step) => {
  const colours = Object.assign({}, project.colours, { [id]: look });
  onPatch({ colours }, step);
};

const opacityRow = (project, onPatch) =>
  track([0, 100], {
    label: tr("Прозрачность"),
    value: 100 - project.opacity,
    step: 1,
    format: percentText,
    onChange: patcher(onPatch, "opacity", "Прозрачность линий", (value) => 100 - value),
  });

const shapeSlider = (project, onPatch, spec) =>
  track(MSL_LIMITS[spec.key], {
    label: spec.title(),
    value: project[spec.key],
    step: spec.step,
    format: spec.show,
    onChange: patcher(onPatch, spec.key, spec.journal),
  });

const resetActions = (project, item, onPatch) => {
  if (project.ownColour) return [false, false];
  const dropOne = () =>
    onPatch({ colours: without(project.colours, item.id) }, `${item.many} линии: как в моде`);
  const dropAll = patcher(onPatch, "colours", "Все цвета как в моде", () => ({}));
  return [
    project.colours[item.id] && action("reset-colour", tr("Вернуть цвет мода"), dropOne),
    colourCount(project.colours) > 1 && action("reset-all", tr("Вернуть все цвета"), dropAll),
  ];
};

const paletteRow = ({ item, project, colourId, onColour, onPatch }) => {
  const { id, colour } = item;
  const on = id === colourId;
  const { label, state, swatch } = mslColourRow(project, id);
  const card = {
    label: tr("Цвет"),
    subject: label,
    value: mslColourLook(project, id),
    swatches: leadWith(colour),
    note: tr("Первый цвет — цвет мода. «Снизу вверх» видно на стенке."),
    onChange: colourPatcher(project, id, onPatch),
  };
  const pick = h(NavRow, {
    "aria-pressed": on,
    caption: state || null,
    className: on ? "is-selected" : "",
    onOpen: () => onColour(id),
    title: tr(label),
    trailing: h(ListSwatch, { colour: swatch }),
  });
  const inner = on
    ? h(ListSub, { role: "group", "aria-label": tr("Облик цвета мода") }, lookField(card))
    : null;
  return h(Fragment, { key: id }, pick, inner);
};

// Разделы по инструментам колонки. Ключи с заглавной буквы: это компоненты.
const Sections = {
  Distance({ project, tilePlan, onPatch }) {
    useTr();
    const { drawDistance, width } = project;
    const notes = [trFill("Дальность у мода — {0}.", distanceText(MSL_MOD_DISTANCE))];
    notes.push(distanceHint(drawDistance, width, tilePlan?.plan, tilePlan?.look));
    const quick = h(SegmentedControl, {
      label: tr("Быстрая дальность"),
      size: "sm",
      options: distanceOptions(drawDistance).map(translated),
      value: drawDistance,
      onChange: patcher(onPatch, "drawDistance", "Дальность линий"),
    });
    return plainGroup(tr("Дальность прорисовки"), notes, quick);
  },

  Shape({ project, onPatch }) {
    useTr();
    const lead = tr("Стенка сплошная, видна с обеих сторон; цвет и прозрачность — как у ленты.");
    const modWidth = trFill("Ширина у мода — {0}.", metresText(MSL_MOD_WIDTH));
    const sliders = SHAPE_SLIDERS.map((spec) => shapeSlider(project, onPatch, spec));
    return plainGroup(tr("Ширина и высота"), [lead, modWidth], ...sliders);
  },

  Palette({ project, colourId, onColour, onPatch }) {
    useTr();
    const rows = MSL_PALETTE.map((item) =>
      paletteRow({ item, project, colourId, onColour, onPatch }),
    );
    return h(ListGroup, { label: tr("Цвета линий мода") }, rows);
  },

  Look({ project, colourId, onColour, onPatch }) {
    useTr();
    const own = project.ownColour;
    const item = colourOf(colourId);
    const mode = h(SegmentedControl, {
      label: tr("Облик"),
      size: "sm",
      options: modeOptions(),
      value: own ? "all" : "each",
      onChange: modeHandler(project, onPatch),
    });
    const shared = own
      ? lookField({
          label: tr("Цвет"),
          subject: tr("Цвет линий"),
          value: project.look,
          swatches: MSL_SWATCHES,
          note: tr(
            "«Снизу вверх» видно на стенке: у ленты на земле — нижний цвет. Выберите «Свой у каждого цвета» — и каждый цвет мода получит свой облик.",
          ),
          onChange: stepPatcher(onPatch, "look"),
        })
      : null;
    const modeHelp = tr(
      "«Один на все линии» — один облик на все линии. «Свой у каждого цвета» — каждый из девяти цветов мода красится отдельно.",
    );
    const palette = own
      ? null
      : h(Sections.Palette, { project, colourId: item.id, onColour, onPatch });
    return h(
      Fragment,
      null,
      plainGroup(tr("Цвет линий"), modeHelp, mode, shared),
      palette,
      plainGroup(
        tr("Прозрачность линий"),
        tr("0 % — сплошные, как у мода; 100 % — линий не видно совсем."),
        opacityRow(project, onPatch),
      ),
      h(ActionRows, { actions: resetActions(project, item, onPatch) }),
    );
  },
};

// Какой раздел показать и какие свойства ему отдать; всё остальное — шаблоны.
const SECTIONS = new Map([
  ["look", [Sections.Look, ["project", "colourId", "onColour", "onPatch"]]],
  ["shape", [Sections.Shape, ["project", "onPatch"]]],
  ["distance", [Sections.Distance, ["project", "tilePlan", "onPatch"]]],
]);

const bodyFor = (tool, ctx) => {
  const entry = SECTIONS.get(tool);
  if (!entry) return h(MslZonesPresets, { project: ctx.presetProject, onApply: ctx.onPreset });
  const [Body, keys] = entry;
  return h(Body, Object.fromEntries(keys.map((key) => [key, ctx[key]])));
};

const MslZonesInspector = (props) => {
  useTr();
  const { project, onStandard } = props;
  const { tool = "look", presetProject = project } = props;
  const { colourId = "blue", tilePlan = null } = props;

  const body = bodyFor(tool, { ...props, presetProject, colourId, tilePlan });
  const standard =
    onStandard && !mslZonesIsMod(project) && action("standard", tr("Как в игре"), onStandard);

  return h(
    "div",
    { className: "fx-inspector recolor-inspector" },
    body,
    h(ActionRows, { actions: [standard] }),
  );
};

export default MslZonesInspector;
