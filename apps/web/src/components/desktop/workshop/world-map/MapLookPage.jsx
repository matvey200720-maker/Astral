import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { lowerFor, mapText } from "./map-copy.js";
import { counted } from "../../../../plural.js";
import { createElement as el, Fragment, useMemo } from "react";
import {
  mapColorModel,
  MOD_PACK_TEMPLATE,
  resetMapColor,
  resetMapColors,
  setMapColor,
  setMapColorStrength,
} from "@modovik/vector-map";
import {
  Stack,
  Mountains,
  GridFour,
  Palette,
  ArrowCounterClockwise,
} from "../../../ui/icons.jsx";
import ChoiceRadioGroup from "../../../ui/ChoiceRadioGroup.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import ModName from "../../catalog/ModName.jsx";
import { MapColorsPanel } from "../WorldMapStylePanels.jsx";
import { PanelSection, ColorLine, Disclosure } from "./MapPanelParts.jsx";
import { LookPicture, LOOK_CHOICES, GAME_LOOK, currentLook } from "./MapLooks.jsx";
import { SchematicLines, SCHEMATIC_COLORS, MapTone } from "./MapTone.jsx";

const GRID_ON = 34; // значение прозрачности сетки при включении
const either = (on, yes, no) => (on ? yes() : no());

// ---------- 1. основа карты ----------

const tileOf = (kind, id) => ({ kind, id, value: id });

// плитка «Карта из мода»: стоит первой, если у проекта есть происхождение мода
const MOD_TILE = { ...tileOf("template", MOD_PACK_TEMPLATE), title: "Карта из мода", vector: true };

// плитка «Как в игре» — первая плитка вида style из набора
const STYLE_TILE = LOOK_CHOICES.find((tile) => tile.kind === "style") ?? GAME_LOOK;

function tileCopy(tile, packOrigin) {
  if (tile !== MOD_TILE) {
    const note = tr(tile.description);
    return { description: note, tooltip: note };
  }
  const name = packOrigin.title || tr("Большая карта мода");
  return { description: el(ModName, { name }), tooltip: name };
}

const lookTile = (tile, thumbs, packOrigin) => ({
  value: tile.value,
  title: tr(tile.title),
  ...tileCopy(tile, packOrigin),
  media: el(LookPicture, { look: tile, thumbs }),
});

const answerFor = (tile) =>
  tile.kind === "style" ? { kind: "game" } : { kind: "template", id: tile.id };

function BaseChoice({ config, thumbs, onChoose }) {
  useTr();
  const { packOrigin } = config.base;
  const tiles = packOrigin ? [MOD_TILE, ...LOOK_CHOICES] : [...LOOK_CHOICES];
  const byValue = new Map(tiles.map((tile) => [tile.value, tile]));
  const look = currentLook(config);

  const pick = (value) => {
    const tile = byValue.get(value);
    if (tile) onChoose(answerFor(tile));
  };

  const group = el(ChoiceRadioGroup, {
    label: tr("Основа карты"),
    value: look.kind === "template" ? look.id : STYLE_TILE.value,
    options: tiles.map((tile) => lookTile(tile, thumbs, packOrigin)),
    onChange: pick,
    className: "wmc-look-grid",
  });
  return el(PanelSection, { title: tr("Основа карты"), icon: el(Stack) }, group);
}

// ---------- 2. рельеф и сетка ----------

const switchRow = (icon, caption, props) =>
  el(
    "label",
    { className: "ui-field wmc-switch-line wmc-list-switch" },
    el("span", null, icon, caption),
    el(Switch, props),
  );

function ReliefGrid({ base, vector, patchBase }) {
  useTr();
  const rows = [
    switchRow(el(Mountains), tr("Рельеф"), {
      checked: vector && base.reliefOn,
      label: tr("Рельеф на карте"),
      disabled: !vector,
      onChange: (on) =>
        patchBase(
          { reliefOn: on },
          either(on, () => tr("Рельеф включён"), () => tr("Рельеф выключен")),
          "base.reliefOn",
        ),
    }),
    vector ? null : el("small", { className: "wmc-hint" }, tr("Есть только у векторных карт")),
    switchRow(el(GridFour), tr("Сетка координат"), {
      checked: base.gridOpacity > 0,
      label: tr("Сетка координат"),
      onChange: (on) =>
        patchBase(
          { gridOpacity: on ? GRID_ON : 0 },
          either(on, () => tr("Сетка показана"), () => tr("Сетка скрыта")),
          "base.gridOpacity",
        ),
    }),
  ];
  const attrs = { title: tr("Рельеф и сетка"), icon: el(Mountains), className: "wmc-relief-grid" };
  return el(PanelSection, attrs, ...rows);
}

// ---------- 3а. цвета векторной карты ----------

const chosenCaption = (lang, label) =>
  mapText("Цвет: {name}", { name: lowerFor(lang, tr(label)) });

function modifiedLabel(count) {
  if (count === 0) return tr("Как в оригинале");
  const words = [tr("цвет"), tr("цвета"), tr("цветов")];
  return mapText("Изменено: {count}", { count: counted(count, words) });
}

// действия над цветами: все обращаются наружу через onConfig
function colorActions({ config, context, onConfig, lang }) {
  const restore = (item) =>
    onConfig(
      resetMapColor(config, item.id, context),
      mapText("Цвет возвращён: {name}", { name: lowerFor(lang, tr(item.label)) }),
    );
  return {
    restore,
    choose(item, color) {
      if (color.toLowerCase() !== item.native) {
        const caption = chosenCaption(lang, item.label);
        onConfig(setMapColor(config, item.id, color, context), caption, `color.${item.id}`);
        return;
      }
      restore(item);
    },
    strength(item, value) {
      const caption = mapText("{name}: сила", { name: tr(item.label) });
      onConfig(setMapColorStrength(config, item.id, value), caption, `base.${item.strength.key}`);
    },
    resetAll: () => onConfig(resetMapColors(config, context), tr("Цвета карты возвращены")),
  };
}

function strengthRow(item, act) {
  const power = item.strength;
  if (!power || !(power.value > 0)) return null;
  const range = { min: power.min, max: power.max, step: power.step, unit: power.unit };
  const slider = el(Slider, {
    ...range,
    value: power.value,
    label: tr(power.label),
    onChange: (value) => act.strength(item, value),
  });
  return el("div", { className: "wmc-color-strength" }, slider);
}

function colorRow(item, act) {
  const line = el(ColorLine, {
    onChange: (color) => act.choose(item, color),
    onReset: () => act.restore(item),
    changed: item.changed,
    defaultValue: item.native,
    value: item.value,
    label: tr(item.label),
  });
  return el("div", { key: item.id }, line, strengthRow(item, act));
}

const colorGroup = (group, act) =>
  el(
    "div",
    { key: group.id, className: "wmc-color-group", "data-color-group": group.id },
    el("h4", null, tr(group.title)),
    el("div", { className: "wmc-color-lines" }, group.items.map((item) => colorRow(item, act))),
  );

const STRIP_ATTRS = { className: "wmc-colors-strip", "aria-hidden": "true" };

const colorStrip = (model) =>
  el(
    "span",
    STRIP_ATTRS,
    model.strip.map((color, at) => el("i", { key: `${color}-${at}`, style: { background: color } })),
  );

function resetAllButton(model, act) {
  if (!(model.changed > 0)) return null;
  const caption = tr("Вернуть все цвета как были");
  const attrs = {
    type: "button",
    className: "wmc-eye wmc-reset",
    "aria-label": caption,
    title: caption,
    onClick: act.resetAll,
  };
  return el("button", attrs, el(ArrowCounterClockwise));
}

function VectorColors({ config, model, context, onConfig }) {
  useTr();
  const lang = useUiLanguage();
  const act = colorActions({ config, context, onConfig, lang });

  const copy = el(
    "span",
    { className: "wmc-colors-copy" },
    el("b", null, tr("Цвета карты")),
    el("small", null, modifiedLabel(model.changed)),
  );
  const head = el("div", { className: "wmc-colors-head is-static" }, colorStrip(model), copy);

  return el(
    "section",
    { className: "ui-panel wmc-section wmc-map-section wmc-colors", "aria-label": tr("Цвета карты") },
    el("div", { className: "wmc-colors-top" }, head, resetAllButton(model, act)),
    el("div", { className: "wmc-colors-body" }, model.groups.map((group) => colorGroup(group, act))),
  );
}

// ---------- 3б. остальные виды цветов ----------

const colorsPanel = (extra) => el(PanelSection, { title: tr("Цвета"), icon: el(Palette), ...extra });

function schematicBlock({ base, lang, patchBase }) {
  const lines = SCHEMATIC_COLORS.map(({ key, label }) =>
    el(ColorLine, {
      key,
      label: tr(label),
      value: base[key],
      onChange: (color) => patchBase({ [key]: color }, chosenCaption(lang, label), `base.${key}`),
    }),
  );
  const palette = el(
    PanelSection,
    { title: tr("Цвета схемы"), icon: el(Palette), hint: tr("Щёлкните по образцу — палитра.") },
    el("div", { className: "wmc-color-lines" }, lines),
  );
  const roads = el(PanelSection, { title: tr("Дороги и берег") }, el(SchematicLines, { base, onPatch: patchBase }));
  return el(Fragment, null, palette, roads);
}

function detectedBlock({ base, mapColors, patchBase }) {
  const recolor = el(Switch, {
    checked: base.recolor,
    label: tr("Перекрашивать карту"),
    onChange: (on) =>
      patchBase(
        { recolor: on },
        either(on, () => tr("Перекраска карты включена"), () => tr("Перекраска карты выключена")),
        "base.recolor",
      ),
  });
  const panel = el(MapColorsPanel, { base, colors: mapColors, onPatch: patchBase });
  return colorsPanel({ actions: recolor, children: panel });
}

const noteBlock = (text) => () => colorsPanel({ hint: text() });

// какой блок цветов показать: первое подходящее условие
const COLOR_BLOCKS = [
  {
    when: (kit) => kit.vector && kit.model.groups.length > 0,
    build: (kit) => el(VectorColors, kit),
  },
  {
    when: (kit) => kit.vector,
    build: noteBlock(() => tr("Цвета этой карты не подобраны — подстройте тон ниже.")),
  },
  {
    when: (kit) => kit.model.source === "image",
    build: noteBlock(() =>
      tr(
        "Это снимок — по слоям его не перекрасить. Выберите векторную карту, чтобы менять воду, пляжи и дороги, или подстройте тон ниже.",
      ),
    ),
  },
  { when: (kit) => kit.model.source === "schematic", build: schematicBlock },
  { when: () => true, build: detectedBlock },
];

// ---------- тон ----------

function toneSection({ base, source, memoryId, patchBase }) {
  const body = el(MapTone, { base, source, onPatch: patchBase });
  return el(
    "section",
    { className: "ui-panel wmc-section wmc-map-section wmc-map-list", "aria-label": tr("Тон карты") },
    el(Disclosure, { label: tr("Тон и общий цвет"), memoryId, memoryKey: "toneOpen" }, body),
  );
}

// ---------- страница ----------

// модель цветов считается при смене config, geometry или длины списка найденных цветов
function useColorModel(config, geometry, mapColors) {
  const foundCount = mapColors.length;
  const context = useMemo(() => ({ geometry, detected: foundCount > 0 }), [geometry, foundCount]);
  const model = useMemo(() => mapColorModel(config, context), [config, context]);
  return { context, model };
}

export default function MapLookPage(props) {
  const { config, thumbs = {}, geometry = false, mapColors = [], source = "", memoryId = "" } = props;
  const { onChoose, onConfig, patchBase } = props;
  useTr();
  const lang = useUiLanguage();
  const { context, model } = useColorModel(config, geometry, mapColors);

  const base = config.base;
  const vector = ["pack", "game"].includes(model.source);
  const kit = { config, base, model, context, vector, mapColors, lang, onConfig, patchBase };
  const { build } = COLOR_BLOCKS.find(({ when }) => when(kit));

  return el(
    Fragment,
    null,
    el(BaseChoice, { config, thumbs, onChoose }),
    el(ReliefGrid, { base, vector, patchBase }),
    build(kit),
    toneSection({ base, source, memoryId, patchBase }),
  );
}
