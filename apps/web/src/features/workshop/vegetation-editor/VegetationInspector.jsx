import ListGroup from "../../../components/ui/ListGroup.jsx";
import { Fragment, createElement as h } from "react";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import { sharedGrassZone, varietyActive } from "@modovik/climb-contract/recolor/vegetation";
import Slider from "../../../components/ui/Slider.jsx";
import { trFill } from "../../../locales/tr-fill.js";
import NavRow from "../../../components/ui/NavRow.jsx";
import { BushFields, FlowerFields, ForestFields, SpeciesColours } from "./VegetationWorldFields.jsx";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import Switch from "../../../components/ui/Switch.jsx";
import { VarietyFields } from "./VegetationVarietyFields.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { currentUiLanguage, tr, useTr } from "../../../locales/ui.js";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { sandyFilesText, zoneWeightText } from "./sandy-text.js";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import {
  GRASS_DIRECTION_LABELS,
  GRASS_MODE_OPTIONS,
  GRASS_SWATCHES,
  GRASS_ZONES,
  GRASS_ZONE_CHOICES,
  LEAF_SWATCHES,
  SANDY_EFFECT_MODES,
  TREE_DIRECTION_LABELS,
  foliageHint,
  percentText,
} from "./vegetation-text.js";
import SectionHeading from "../section-help.jsx";
import VegetationPresets from "./VegetationPresets.jsx";

/* ---------- Общие мелочи ---------- */

// Запись в проект одним описанием: раздел, значения, подпись шага.
const commit = (onPatch, { where, what, note }) => onPatch(where, what, note);

const either = (flag, yes, no) => (flag ? yes : no);

const given = (value, fallback) => (value === undefined ? fallback : value);

const makeAction = (id, label, onClick) => ({ id, label, onClick });

const frozenMap = (pairs) => {
  const table = Object.fromEntries(pairs);
  return Object.freeze(table);
};

/* ---------- Тексты (ключи словаря — по-русски) ---------- */

const TREE_HINTS = frozenMap([
  ["gradient", "Два цвета: «По породам» — у каждой породы своя доля, «Вдоль листа» — от кончика к основанию, «По яркости» — тени и блики."],
  ["rainbow", "Радуга по выбранному направлению: «По породам» — каждая порода своего цвета."],
  ["shimmer", "Оттенки гуляют вокруг цвета. В игре перелив неподвижный: лист — неподвижная текстура."],
  ["line", "Две краски чередуются; у листвы «ширина» — сколько пород на полосу."],
]);

// Ключ «зона.вид»: вид — mod или colour.
const ZONE_EFFECT_TEXT = frozenMap([
  ["country.mod", "Пустыня, холмы и горы в зелёной траве мода «зеленый сенди шортс» — вблизи и вдали: листы мода в словарях земли и их дальних планах, песок дальних видов сверху — в зелень мода."],
  ["country.colour", "Вся трава за городом своего цвета: трава мода на месте пустыни, штатная трава холмов, лесов, ферм, трава и кустарник на скалах, травинки, наземные растения и дальние планы — на всех дистанциях одним цветом. Цветы на траве — с лепестками своего цвета. Камни, земля и дороги остаются."],
  ["city.mod", "Пустыри города в траве мода. Газоны, парки и гольф-клуб — как в игре: мод их не трогает."],
  ["city.colour", "Вся трава города своего цвета: газоны, парки, гольф-клуб вблизи и вдали, обочины, трава аэропорта, пустыри и сорняки у бордюров, травинки и газоны дальних видов сверху. Деревья — инструментом «Листва», кусты, изгороди и плющ — «Кусты»."],
  ["both.mod", "Пустыня, холмы и горы за городом и пустыри города — в траве мода, вблизи и вдали. Газоны, парки и гольф-клуб — как в игре: мод их не трогает."],
  ["both.colour", "Вся трава и за городом, и в городе одного цвета: трава мода на месте пустыни, трава холмов, лесов и ферм, газоны, парки, гольф-клуб, обочины, травинки, пучки, которые игра сама рассыпает по земле, и дальние планы. Цветы на траве — с лепестками своего цвета. Камни, земля и дороги остаются."],
]);

const SHARED_TEXT = frozenMap([
  ["off", "Пучки травы, которые игра сама рассыпает по земле, — одни на весь мир: они берут цвет, только когда своим цветом красятся обе зоны. Сейчас они как в игре."],
  ["country", "Пучки травы, которые игра сама рассыпает по земле, — одни на весь мир: и в городе они цвета травы за городом."],
]);

const BOTH_DIRECTION_LABELS = frozenMap([
  ["along", "С запада на восток"],
  ["across", "С юга на север"],
  ["height", "От середины зоны"],
]);

function gradientHint(zone) {
  switch (zone) {
    case "both":
      return tr("Два цвета через каждую зону: «С запада на восток», «С юга на север» или «От середины зоны» — от Сэнди-Шорс и от центра города к краям.");
    case "city":
      return tr("Два цвета через весь город: «С запада на восток», «С юга на север» или «От центра города» — от Пиллбокс-Хилл к окраинам.");
    default:
      return tr("Два цвета через всю загородную карту: «С запада на восток», «С юга на север» или «От Сэнди-Шорс» — от города к краям.");
  }
}

const grassHints = (zone) =>
  frozenMap([
    ["gradient", gradientHint(zone)],
    ["rainbow", tr("Радуга через всю зону по выбранному направлению; сдвиг — с какого цвета она начинается.")],
    ["shimmer", tr("Оттенки гуляют вокруг цвета по карте. В игре перелив неподвижный: трава — неподвижная текстура.")],
  ]);

/* ---------- Мелкие функции ---------- */

function varietyPaintsTrees({ variety }) {
  return varietyActive(variety) && variety.trees;
}

const lowerWord = (text) => {
  const lang = currentUiLanguage();
  return lang === "de" ? text : text.toLocaleLowerCase(lang);
};

function zoneStateText(part) {
  if (!part.enabled) return tr("как в игре");
  return either(part.grass === "colour", tr("свой цвет"), tr("как в моде"));
}

// Копии вариантов с переведёнными подписями.
function relabel(items) {
  return items.map((item) => {
    const copy = Object.assign({}, item);
    copy.label = tr(item.label);
    return copy;
  });
}

// Строки справки для ListGroup: ложные отброшены, остальные переведены.
function translatedLines(help) {
  const lines = [];
  for (const text of [help].flat()) {
    if (text) lines.push(tr(text));
  }
  return lines;
}

/* ---------- Оболочка раздела ---------- */

function Section(props) {
  const title = given(props.title, "");
  const frame = { className: "ui-panel fx-section recolor-section", "aria-label": props.label || title };
  if (!title) {
    const group = { plain: true, help: translatedLines(given(props.help, null)) };
    return h("section", frame, h(ListGroup, group, props.children));
  }
  const help = given(props.help, null);
  const action = given(props.action, null);
  const head = help || action ? h(SectionHeading, { title, help, actions: action }) : h("h3", null, title);
  return h("section", frame, head, props.children);
}

/* ---------- Листва ---------- */

function VarietyNotice({ project }) {
  useTr();
  if (varietyPaintsTrees(project)) {
    const heading = tr("Сейчас цвет деревьев задаёт «В разнобой»");
    const note = tr("«Цвет листвы» не действует, а свой цвет вида побеждает палитру у своего вида.");
    return h(Section, { title: heading, label: heading, help: note });
  }
  return null;
}

function leafColourRow(trees, onPatch) {
  const name = tr("Цвет листвы");
  let current = null;
  if (trees.tint) current = normalizeColourEffect(trees.look).colour;
  const row = {
    group: true,
    title: name,
    label: name,
    value: current,
    colours: LEAF_SWATCHES,
    onChange(colour) {
      const look = normalizeColourEffect(Object.assign({}, trees.look, { mode: "solid", colour }));
      return commit(onPatch, { where: "trees", what: { tint: true, look }, note: tr("Свой цвет листвы") });
    },
    onClear() {
      return commit(onPatch, { where: "trees", what: { tint: false }, note: tr("Листва как в игре") });
    },
  };
  const effect = {
    label: name,
    value: trees.look,
    swatches: LEAF_SWATCHES,
    directionLabels: TREE_DIRECTION_LABELS,
    hints: TREE_HINTS,
    onChange: (look, step) => commit(onPatch, { where: "trees", what: { look }, note: step }),
  };
  return h(ColourRow, row, trees.tint ? h(ColourEffectField, effect) : undefined);
}

function FoliageFields({ project, onPatch }) {
  useTr();
  const trees = project.trees;
  const byPalette = varietyPaintsTrees(project);
  const density = {
    label: tr("Густота листвы"),
    value: trees.foliage,
    min: 0,
    max: 100,
    step: 5,
    format: percentText,
    onChange: (foliage) => commit(onPatch, { where: "trees", what: { foliage }, note: "Густота листвы" }),
  };
  const hint = foliageHint(trees.foliage);
  const translucency = tr("Полупрозрачной листвы у GTA нет: «прозрачность» здесь — густота, доля листьев, которые остаются.");
  const help = ["", hint, translucency];
  if (!byPalette && !trees.tint) {
    help[0] = tr("Цвет Rockstar. Включите свой — листва деревьев и растений перекрасится вблизи и вдали; большие кусты и изгороди — как скажет инструмент «Кусты» (сначала — вместе с листвой).");
  }
  return h(Section, { label: tr("Листва"), help }, byPalette ? null : leafColourRow(trees, onPatch), h(Slider, density));
}

// Кнопки под листвой: «убрать/вернуть» и, если красит разнобой, «выключить разнобой».
function leafActions(project, onPatch) {
  const setFoliage = (foliage, note) => commit(onPatch, { where: "trees", what: { foliage }, note });
  const toggle =
    project.trees.foliage > 0
      ? makeAction("leaves-off", tr("Убрать листву"), () => setFoliage(0, tr("Деревья без листвы")))
      : makeAction("leaves-on", tr("Вернуть листву"), () => setFoliage(100, tr("Листва на месте")));
  const calm =
    varietyPaintsTrees(project) &&
    makeAction("variety-off", tr("Выключить разнобой"), () =>
      commit(onPatch, { where: "variety", what: { enabled: false }, note: tr("Деревья одного цвета") }),
    );
  return h(ActionRows, { actions: [toggle, calm] });
}

/* ---------- Реалистичные деревья ---------- */

function ImprovedFields(props) {
  useTr();
  const name = tr("Реалистичные деревья");
  const toggle = {
    checked: props.project.improved.enabled,
    label: name,
    onChange: (enabled) =>
      commit(props.onPatch, {
        where: "improved",
        what: { enabled },
        note: either(enabled, tr("Реалистичные деревья"), tr("Модели игры")),
      }),
  };
  const help = tr("Встроены в Astral, искать ничего не нужно. Встают вместо деревьев игры и красятся вместе с листвой.");
  return h(Section, { title: name, label: name, help, action: h(Switch, toggle) });
}

/* ---------- Трава по миру ---------- */

const grassPart = (sandy, zone) => {
  if (zone === "both") return sandy.both;
  return sandy.zones[zone];
};

const fieldsOpen = (sandy, part, both) => {
  if (both) return sandy.both.enabled;
  return !sandy.both.enabled && part.enabled;
};

// Патчи «Обе сразу» и одной зоны собираются по частям.
const bothPatch = (sandy, values) => ({ both: Object.assign({}, sandy.both, values) });

function zonePatch(sandy, zone, values) {
  const zones = Object.assign({}, sandy.zones);
  zones[zone] = Object.assign({}, sandy.zones[zone], values);
  return { zones };
}

// Всё, что нужно вкладке травы: выбранная зона, её часть проекта и записывающие функции.
function grassContext(project, asked, onZone, onPatch) {
  const sandy = project.sandy;
  let zone = "country";
  if (GRASS_ZONE_CHOICES.map((choice) => choice.value).includes(asked)) zone = asked;
  const view = { project, sandy, zone, onZone, both: zone === "both" };
  const { both } = view;
  const part = grassPart(sandy, zone);
  view.part = part;

  view.setPart = (values, label) =>
    commit(onPatch, {
      where: "sandy",
      what: both ? bothPatch(sandy, values) : zonePatch(sandy, zone, values),
      note: label,
    });
  view.setBoth = (enabled) =>
    commit(onPatch, {
      where: "sandy",
      what: bothPatch(sandy, { enabled }),
      note: either(enabled, tr("Одна трава на обе зоны"), tr("Трава каждой зоны")),
    });
  view.zoneInfo = GRASS_ZONES.find(({ id }) => id === zone);
  view.directionLabels = both ? BOTH_DIRECTION_LABELS : GRASS_DIRECTION_LABELS[zone];
  view.colourPart = part.grass === "colour";
  view.fieldsShown = fieldsOpen(sandy, part, both);
  return view;
}

// Пояснение про общие пучки травы: только у одиночной зоны со своим цветом.
function sharedNoteOf(view) {
  if (view.both || view.sandy.both.enabled || !view.part.enabled || !view.colourPart) return "";
  if (!sharedGrassZone(view.project)) return SHARED_TEXT.off;
  return view.zone === "city" ? SHARED_TEXT.country : "";
}

function introLine(view) {
  if (!view.sandy.enabled) {
    return tr("Трава Rockstar. Включите — и выберите зону: «За городом» (пустыня, холмы, горы, леса и фермы) или «В городе» (газоны, парки, обочины, аэропорт). У каждой — трава мода или свой цвет: цвет, градиент, радуга.");
  }
  if (view.both) {
    return tr("Одна трава на обе зоны: включите — она ляжет и за городом, и в городе; выключите — вернутся настройки каждой зоны, «Обе сразу» их не трогает.");
  }
  return tr(view.zoneInfo?.note || "");
}

// Строка про пакет: сколько словарей и карт уйдёт в игру.
function packLine(project) {
  const pack = sandyFilesText(project);
  let tail = "";
  if (pack.grass) tail = trFill(" и {0} карт травы", pack.grass);
  return trFill(
    "Зона — по тому, где стоят вещи, которые берут лист: общий словарь земли красится той зоной, где его вещей больше, поэтому трава аэропорта и обочин города не берёт цвет пустыни. В игру уйдут {0} словарей земли, {1} дальних планов{2} ≈ {3} МБ — своим пакетом дополнения Astral, update.rpf не растёт.",
    pack.files,
    pack.distant,
    tail,
    pack.megabytes,
  );
}

// Семь строк справки; неподходящие по условию остаются пустыми.
function grassHelp(view) {
  const { sandy, both, fieldsShown } = view;
  const sharedNote = sharedNoteOf(view);
  const effectKey = `${view.zone}.${either(view.colourPart, "colour", "mod")}`;
  const lines = [
    [true, () => tr("Своя трава в городе и за городом — вблизи, вдали и в супердали одним цветом")],
    [true, () => introLine(view)],
    [
      !both && sandy.both.enabled,
      () =>
        trFill(
          "Сейчас обе зоны красит «Обе сразу» — {0}. Настройки этой зоны не потеряны: выключите «Обе сразу», и они вернутся.",
          zoneStateText(sandy.both),
        ),
    ],
    [fieldsShown, () => tr(ZONE_EFFECT_TEXT[effectKey])],
    [
      fieldsShown && view.colourPart,
      () => tr("Это трава, а не заливка: у каждой травинки остаются её яркость, тени и рисунок, трава берёт тон и насыщенность цвета, а светлота цвета — во сколько раз трава светлее или темнее зелени мода."),
    ],
    [fieldsShown && sharedNote, () => tr(sharedNote)],
    [sandy.enabled, () => packLine(view.project)],
  ];
  return lines.map(([on, say]) => (on ? say() : ""));
}

// «Органы травы вкладки»: способ окраски и, для своего цвета, поле эффекта.
function grassLook(view) {
  const { part } = view;
  const mode = {
    label: tr("Трава"),
    size: "sm",
    options: relabel(GRASS_MODE_OPTIONS),
    value: part.grass,
    onChange(value) {
      const saying = either(value === "mod", tr("Трава как в моде"), tr("Свой цвет травы"));
      return view.setPart({ grass: value }, saying);
    },
  };
  const effect = {
    label: tr("Цвет травы"),
    value: part.look,
    modes: SANDY_EFFECT_MODES,
    swatches: GRASS_SWATCHES,
    directionLabels: view.directionLabels,
    hints: grassHints(view.zone),
    onChange: (look, step) => view.setPart({ look }, step),
  };
  return h(Fragment, null, h(SegmentedControl, mode), view.colourPart ? h(ColourEffectField, effect) : null);
}

function zoneRows(view) {
  return GRASS_ZONES.map((item) =>
    h(NavRow, {
      key: item.id,
      title: tr(item.label),
      caption: zoneStateText(view.sandy.zones[item.id]),
      onOpen: () => view.onZone?.(item.id),
    }),
  );
}

// Три вида тела вкладки: «Обе сразу», зона под общей краской, обычная зона.
const GRASS_BODIES = {
  both(view) {
    const on = view.sandy.both.enabled;
    const line = {
      label: tr("Одна трава на обе зоны"),
      hint: on ? zoneWeightText("both", view.part.grass === "mod") : "",
      checked: on,
      onChange: view.setBoth,
    };
    const rest = on ? grassLook(view) : h(ListGroup, { title: tr("Трава каждой зоны") }, zoneRows(view));
    return h(Fragment, null, h(SwitchLine, line), rest);
  },
  paired(view) {
    const row = { title: tr("Обе сразу"), caption: zoneStateText(view.sandy.both), onOpen: () => view.onZone?.("both") };
    return h(ListGroup, { label: tr("Обе сразу") }, h(NavRow, row));
  },
  single(view) {
    const { part, zone, zoneInfo } = view;
    const line = {
      label: trFill("Красить: {0}", lowerWord(tr(zoneInfo.label))),
      hint: zoneWeightText(zone, part.grass === "mod"),
      checked: part.enabled,
      onChange: (enabled) =>
        view.setPart({ enabled }, `${tr(zoneInfo.short)}: ${either(enabled, tr("своя трава"), tr("как в игре"))}`),
    };
    return h(Fragment, null, h(SwitchLine, line), part.enabled ? grassLook(view) : null);
  },
};

function bodyKindOf(view) {
  if (view.both) return "both";
  return view.sandy.both.enabled ? "paired" : "single";
}

function GrassFields(props) {
  useTr();
  const { onPatch } = props;
  const view = grassContext(props.project, given(props.zone, "country"), given(props.onZone, null), onPatch);
  const sandy = view.sandy;
  const name = tr("Трава по миру");
  const master = {
    checked: sandy.enabled,
    label: name,
    onChange: (enabled) =>
      commit(onPatch, { where: "sandy", what: { enabled }, note: either(enabled, tr("Трава по миру"), tr("Трава как в игре")) }),
  };
  const picker = {
    label: tr("Какую траву красить"),
    size: "sm",
    options: relabel(GRASS_ZONE_CHOICES),
    value: view.zone,
    onChange: view.onZone,
  };
  const inner = sandy.enabled
    ? h(Fragment, null, h(SegmentedControl, picker), GRASS_BODIES[bodyKindOf(view)](view))
    : undefined;
  const release =
    sandy.enabled &&
    !view.both &&
    sandy.both.enabled &&
    makeAction("both-off", tr("Выключить «Обе сразу»"), () => view.setBoth(false));
  const section = h(Section, { title: name, label: name, help: grassHelp(view), action: h(Switch, master) }, inner);
  return h(Fragment, null, section, h(ActionRows, { actions: [release] }));
}

/* ---------- Выбор панели по инструменту ---------- */

const SIMPLE_PANELS = new Map([
  ["bushes", BushFields],
  ["flowers", FlowerFields],
  ["forest", ForestFields],
  ["improved", ImprovedFields],
  ["variety", VarietyFields],
]);

const INSPECTOR_DEFAULTS = frozenMap([
  ["tool", "foliage"],
  ["zone", "country"],
  ["onZone", null],
  ["species", "oak"],
  ["onSpecies", null],
  ["onPreset", null],
]);

// Умолчания только вместо undefined, как у параметров по умолчанию.
const settle = (props, defaults) =>
  Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, given(props[key], fallback)]));

function panelFor(opts, core, presetProject) {
  const simple = SIMPLE_PANELS.get(opts.tool);
  if (simple) return h(simple, core);
  switch (opts.tool) {
    case "foliage":
      return h(
        Fragment,
        null,
        h(VarietyNotice, core),
        h(FoliageFields, core),
        h(SpeciesColours, Object.assign({ tileProject: presetProject, species: opts.species, onSpecies: opts.onSpecies }, core)),
        leafActions(core.project, core.onPatch),
      );
    case "sandy":
      return h(GrassFields, Object.assign({ zone: opts.zone, onZone: opts.onZone }, core));
    default:
      return opts.onPreset && h(VegetationPresets, { project: presetProject, onApply: opts.onPreset });
  }
}

const VegetationInspector = (props) => {
  const core = { project: props.project, onPatch: props.onPatch };
  const panel = panelFor(settle(props, INSPECTOR_DEFAULTS), core, given(props.presetProject, props.project));
  return h("div", { className: "fx-inspector recolor-inspector" }, panel);
};

export default VegetationInspector;
